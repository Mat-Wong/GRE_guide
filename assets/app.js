(function () {
  const data = window.GRE_DATA;
  const storageKey = "gre-prep-console-v1";

  const titles = {
    dashboard: ["Overview", "总览"],
    vocab: ["Vocabulary", "背词"],
    fill: ["Verbal", "填空"],
    math: ["Quant", "数学"],
    reading: ["Reading", "阅读"],
  };

  const state = {
    view: "dashboard",
    deckId: "equiv",
    mode: "all",
    day: "all",
    query: "",
    currentIndex: 0,
    revealed: false,
    selectedOption: null,
    sessionOptions: {},
    practiceMode: {
      fill: "all",
      math: "all",
      reading: "all",
    },
    practiceDrafts: {},
  };

  let progress = loadProgress();

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return saved && typeof saved === "object" ? saved : { cards: {}, practice: {} };
    } catch (error) {
      return { cards: {}, practice: {} };
    }
  }

  function saveProgress() {
    localStorage.setItem(storageKey, JSON.stringify(progress));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderExplanationText(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function getDeck(id) {
    return data.decks.find((deck) => deck.id === id) || data.decks[0];
  }

  function learnableDecks() {
    return data.decks.filter((deck) => !deck.locked);
  }

  function allLearnableCards() {
    return learnableDecks().flatMap((deck) => deck.cards);
  }

  function cardProgress(cardId) {
    return progress.cards[cardId] || null;
  }

  function statusOf(cardId) {
    return cardProgress(cardId)?.status || "new";
  }

  function statusLabel(status) {
    return {
      new: "未学",
      known: "认识",
      fuzzy: "模糊",
      wrong: "错误",
    }[status] || "未学";
  }

  function progressStats(cards = allLearnableCards()) {
    const total = cards.length;
    let known = 0;
    let fuzzy = 0;
    let wrong = 0;
    let attempts = 0;
    let correct = 0;

    cards.forEach((card) => {
      const item = progress.cards[card.id];
      if (!item) return;
      if (item.status === "known") known += 1;
      if (item.status === "fuzzy") fuzzy += 1;
      if (item.status === "wrong") wrong += 1;
      attempts += item.attempts || 0;
      correct += item.correct || 0;
    });

    return {
      total,
      known,
      fuzzy,
      wrong,
      untouched: Math.max(0, total - known - fuzzy - wrong),
      attempts,
      correct,
      accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
      completion: total ? Math.round((known / total) * 100) : 0,
    };
  }

  function allPracticeQuestions(type) {
    const items = data.practice[type] || [];
    if (type !== "reading") return items;

    return items.flatMap((passage) => passage.questions.map((question, index) => ({
      ...question,
      id: `${passage.id}-q${index + 1}`,
      parentId: passage.id,
      passage,
      tags: passage.tags || [],
    })));
  }

  function practiceRecord(id) {
    return progress.practice[id] || null;
  }

  function practiceStatus(id) {
    return practiceRecord(id)?.status || "new";
  }

  function practiceStats(type = null) {
    const questions = type
      ? allPracticeQuestions(type)
      : ["fill", "math", "reading"].flatMap((module) => allPracticeQuestions(module));
    let correct = 0;
    let wrong = 0;
    let favorite = 0;
    let attempts = 0;

    questions.forEach((question) => {
      const record = practiceRecord(question.id);
      if (!record) return;
      if (record.status === "correct") correct += 1;
      if (record.status === "wrong") wrong += 1;
      if (record.favorite) favorite += 1;
      attempts += record.attempts || 0;
    });

    return {
      total: questions.length,
      done: correct + wrong,
      correct,
      wrong,
      favorite,
      attempts,
      completion: questions.length ? Math.round(((correct + wrong) / questions.length) * 100) : 0,
      accuracy: correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : 0,
    };
  }

  function filteredPracticeItems(type) {
    const mode = state.practiceMode[type] || "all";
    const items = data.practice[type] || [];

    if (type === "reading") {
      return items.filter((passage) => {
        if (mode === "all") return true;
        return passage.questions.some((question, index) => {
          const record = practiceRecord(`${passage.id}-q${index + 1}`);
          if (mode === "new") return !record;
          if (mode === "wrong") return record?.status === "wrong";
          if (mode === "favorite") return Boolean(record?.favorite);
          return true;
        });
      });
    }

    return items.filter((item) => {
      const record = practiceRecord(item.id);
      if (mode === "all") return true;
      if (mode === "new") return !record;
      if (mode === "wrong") return record?.status === "wrong";
      if (mode === "favorite") return Boolean(record?.favorite);
      return true;
    });
  }

  function normalizeAnswer(answer) {
    return Array.isArray(answer) ? answer : [answer];
  }

  function sameAnswer(left, right) {
    const a = normalizeAnswer(left).map(Number).sort((x, y) => x - y);
    const b = normalizeAnswer(right).map(Number).sort((x, y) => x - y);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function savePracticeAnswer(id, selected, answer) {
    const correct = sameAnswer(selected, answer);
    const previous = progress.practice[id] || {
      attempts: 0,
      correct: 0,
      status: "new",
      selected: [],
      favorite: false,
    };

    previous.attempts += 1;
    previous.correct += correct ? 1 : 0;
    previous.status = correct ? "correct" : "wrong";
    previous.selected = normalizeAnswer(selected);
    previous.updatedAt = new Date().toISOString();
    progress.practice[id] = previous;
    saveProgress();
    return correct;
  }

  function filteredCards() {
    const deck = getDeck(state.deckId);
    const query = state.query.trim().toLowerCase();
    let cards = deck.cards.filter((card) => !card.needsGeneration);

    if (state.day !== "all") {
      cards = cards.filter((card) => String(card.day) === String(state.day));
    }

    if (state.mode === "new") {
      cards = cards.filter((card) => statusOf(card.id) === "new");
    } else if (state.mode === "review") {
      cards = cards.filter((card) => ["wrong", "fuzzy"].includes(statusOf(card.id)));
    } else if (state.mode === "known") {
      cards = cards.filter((card) => statusOf(card.id) === "known");
    }

    if (query) {
      cards = cards.filter((card) => {
        const haystack = [
          card.word,
          card.meaning,
          card.commonMeaning,
          ...(card.synonyms || []),
          ...(card.tags || []),
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }

    return cards;
  }

  function clampCurrent(cards) {
    if (state.currentIndex < 0) state.currentIndex = 0;
    if (state.currentIndex >= cards.length) state.currentIndex = Math.max(0, cards.length - 1);
  }

  function seedFromString(value) {
    let seed = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      seed ^= value.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
  }

  function seededShuffle(items, seedText) {
    const output = [...items];
    let seed = seedFromString(seedText);
    for (let i = output.length - 1; i > 0; i -= 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [output[i], output[j]] = [output[j], output[i]];
    }
    return output;
  }

  function optionsForCard(card) {
    if (state.sessionOptions[card.id]) return state.sessionOptions[card.id];

    if (Array.isArray(card.distractors) && card.distractors.length >= 3) {
      const options = seededShuffle([card.meaning, ...card.distractors.slice(0, 3)], `${card.id}-options`);
      state.sessionOptions[card.id] = options;
      return options;
    }

    const pool = allLearnableCards()
      .map((item) => item.meaning)
      .filter((meaning) => meaning && meaning !== "待补全" && meaning !== card.meaning);
    const uniquePool = [...new Set(pool)];
    const distractors = seededShuffle(uniquePool, `${card.id}-pool`).slice(0, 3);
    const options = seededShuffle([card.meaning, ...distractors], `${card.id}-options`);
    state.sessionOptions[card.id] = options;
    return options;
  }

  function markCard(card, status, selectedCorrect = null) {
    const current = progress.cards[card.id] || {
      attempts: 0,
      correct: 0,
      status: "new",
      history: [],
    };

    const wasQuizAttempt = selectedCorrect !== null;
    current.status = status;
    current.updatedAt = new Date().toISOString();

    if (wasQuizAttempt) {
      current.attempts += 1;
      current.correct += selectedCorrect ? 1 : 0;
      current.history = [...(current.history || []), selectedCorrect ? "correct" : "wrong"].slice(-8);
    }

    progress.cards[card.id] = current;
    saveProgress();
  }

  function revealCard(card, selectedMeaning) {
    const correct = selectedMeaning === card.meaning;
    state.revealed = true;
    state.selectedOption = selectedMeaning;
    markCard(card, correct ? "known" : "wrong", correct);
  }

  function moveCard(step) {
    const cards = filteredCards();
    if (!cards.length) return;
    state.currentIndex = (state.currentIndex + step + cards.length) % cards.length;
    state.revealed = false;
    state.selectedOption = null;
    render();
  }

  function resetCardSession() {
    state.currentIndex = 0;
    state.revealed = false;
    state.selectedOption = null;
    state.sessionOptions = {};
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll(".view").forEach((el) => el.classList.toggle("active", el.id === `view-${view}`));
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
    document.getElementById("viewEyebrow").textContent = titles[view][0];
    document.getElementById("viewTitle").textContent = titles[view][1];
    render();
  }

  function metricCard(label, value, note) {
    return `
      <div class="metric-card">
        <div class="metric-label">${escapeHtml(label)}</div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-note">${escapeHtml(note)}</div>
      </div>
    `;
  }

  function progressTrack(percent) {
    return `<div class="progress-track"><div class="progress-bar" style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>`;
  }

  function renderDashboard() {
    const stats = progressStats();
    const exerciseStats = practiceStats();
    const due = stats.fuzzy + stats.wrong;
    const practiceCards = [
      ["fill", "填空", "单空、双空、六选二"],
      ["math", "数学", "QC、算术、几何、应用题"],
      ["reading", "阅读", "短阅读、主旨、细节、推断"],
    ].map(([type, name, desc]) => {
      const itemStats = practiceStats(type);
      return `
        <article class="module-card">
          <h3>${name}</h3>
          <p>${desc}</p>
          ${progressTrack(itemStats.completion)}
          <div class="module-stat">
            <span>${itemStats.done}/${itemStats.total}</span>
            <span>错题 ${itemStats.wrong}</span>
          </div>
        </article>
      `;
    }).join("");
    const deckCards = learnableDecks()
      .map((deck) => {
        const deckStats = progressStats(deck.cards);
        return `
          <article class="module-card">
            <h3>${escapeHtml(deck.name)}</h3>
            <p>${escapeHtml(deck.description)}</p>
            ${progressTrack(deckStats.completion)}
            <div class="module-stat">
              <span>${deckStats.known}/${deckStats.total}</span>
              <span>${deckStats.completion}%</span>
            </div>
          </article>
        `;
      })
      .join("");

    document.getElementById("view-dashboard").innerHTML = `
      <div class="metrics-grid">
        ${metricCard("可背词条", stats.total, "当前可练词库总量")}
        ${metricCard("已认识", stats.known, `${stats.completion}% 完成`)}
        ${metricCard("练习完成", `${exerciseStats.done}/${exerciseStats.total}`, `${exerciseStats.completion}%`)}
        ${metricCard("错题总数", due + exerciseStats.wrong, `词汇 ${due} / 练习 ${exerciseStats.wrong}`)}
      </div>

      <section class="section-band">
        <div class="section-head">
          <h2>词库进度</h2>
          <span class="section-meta">${learnableDecks().length} 个可背词库</span>
        </div>
        <div class="module-grid">${deckCards}</div>
      </section>

      <section class="section-band">
        <div class="section-head">
          <h2>练习进度</h2>
          <span class="section-meta">原创题库；本地记录正确、错误、收藏</span>
        </div>
        <div class="module-grid">${practiceCards}</div>
      </section>

      <section class="section-band">
        <div class="section-head">
          <h2>今日入口</h2>
          <span class="section-meta">本地进度保存在浏览器 localStorage</span>
        </div>
        <div class="module-grid">
          <article class="module-card">
            <h3>错词复习</h3>
            <p>当前复习池 ${due} 个词。</p>
            <button class="primary-btn" data-dashboard-action="review" type="button">进入复习</button>
          </article>
          <article class="module-card">
            <h3>等价词 Day 1</h3>
            <p>先用等价词建立同义替换网络。</p>
            <button class="ghost-btn" data-dashboard-action="equiv-day1" type="button">开始</button>
          </article>
        </div>
      </section>
    `;
  }

  function renderDeckButtons() {
    return data.decks
      .map((deck) => `
        <button
          class="filter-btn ${deck.id === state.deckId ? "active" : ""}"
          data-deck="${escapeHtml(deck.id)}"
          ${deck.locked ? "disabled" : ""}
          type="button"
        >${escapeHtml(deck.name)} ${deck.locked ? `(${deck.cards.length})` : ""}</button>
      `)
      .join("");
  }

  function renderDayButtons(deck) {
    const days = [...new Set(deck.cards.map((card) => card.day).filter(Boolean))];
    if (!days.length) return "";
    return `
      <div class="toolbar-row">
        <span class="toolbar-label">Day</span>
        <button class="day-btn ${state.day === "all" ? "active" : ""}" data-day="all" type="button">全部</button>
        ${days.map((day) => `<button class="day-btn ${String(state.day) === String(day) ? "active" : ""}" data-day="${day}" type="button">Day ${day}</button>`).join("")}
      </div>
    `;
  }

  function renderVocab() {
    const deck = getDeck(state.deckId);
    const cards = filteredCards();
    clampCurrent(cards);
    const current = cards[state.currentIndex];
    const deckStats = progressStats(deck.cards.filter((card) => !card.needsGeneration));

    document.getElementById("view-vocab").innerHTML = `
      <div class="toolbar">
        <div class="toolbar-row">
          <span class="toolbar-label">词库</span>
          ${renderDeckButtons()}
        </div>
        ${renderDayButtons(deck)}
        <div class="toolbar-row">
          <span class="toolbar-label">队列</span>
          ${["all", "new", "review", "known"].map((mode) => `
            <button class="filter-btn ${state.mode === mode ? "active" : ""}" data-mode="${mode}" type="button">
              ${escapeHtml({ all: "全部", new: "新词", review: "复习", known: "已认识" }[mode])}
            </button>
          `).join("")}
          <label class="sr-only" for="wordSearch">搜索单词</label>
          <input class="search-input" id="wordSearch" value="${escapeHtml(state.query)}" placeholder="搜索单词、释义、标签">
        </div>
      </div>

      <div class="metrics-grid">
        ${metricCard("当前词库", deckStats.total, deck.name)}
        ${metricCard("已认识", deckStats.known, `${deckStats.completion}%`)}
        ${metricCard("复习池", deckStats.fuzzy + deckStats.wrong, "模糊 + 错误")}
        ${metricCard("当前筛选", cards.length, state.query ? "搜索结果" : "可练习词")}
      </div>

      ${current ? renderStudyCard(current, cards) : renderEmptyQueue(deck)}
      ${renderWordList(cards)}
    `;
  }

  function renderEmptyQueue(deck) {
    const locked = deck.locked || deck.cards.every((card) => card.needsGeneration);
    return `
      <div class="empty-state">
        <h2>${locked ? "词库待生成" : "当前队列为空"}</h2>
        <p>${locked ? "这批词只有英文原词，还需要补全释义、助记和例句。" : "切换队列或清空搜索条件后继续。"}</p>
      </div>
    `;
  }

  function renderStudyCard(card, cards) {
    const options = optionsForCard(card);
    const currentStatus = statusOf(card.id);
    const synonyms = card.synonyms?.length ? card.synonyms.join(", ") : "";
    const commonMeaning = card.commonMeaning ? `
      <div class="detail-item">
        <div class="detail-label">常见义</div>
        <p class="detail-value">${escapeHtml(card.commonMeaning)}</p>
      </div>
    ` : "";

    return `
      <div class="study-layout">
        <article class="word-card">
          <div class="card-topline">
            <span>${state.currentIndex + 1} / ${cards.length}</span>
            <span>${escapeHtml(statusLabel(currentStatus))}</span>
          </div>
          <h2 class="word-title">${escapeHtml(card.word)}</h2>
          <div class="tag-row">${(card.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="choice-grid">
            ${options.map((option) => {
              let cls = "";
              if (state.revealed) {
                if (option === card.meaning) cls = "correct";
                else if (option === state.selectedOption) cls = "wrong";
                else cls = "dimmed";
              }
              return `<button class="choice-btn ${cls}" data-choice="${escapeHtml(option)}" type="button">${escapeHtml(option)}</button>`;
            }).join("")}
          </div>
          ${renderFeedback(card)}
          <div class="study-actions">
            <button class="nav-step" data-step="-1" type="button">上一个</button>
            <button class="primary-btn" data-step="1" type="button">下一个</button>
            <button class="quiet-btn" data-reveal="1" type="button">显示详情</button>
          </div>
          <div class="self-mark">
            <button class="quiet-btn mark-known" data-mark="known" type="button">认识</button>
            <button class="quiet-btn mark-fuzzy" data-mark="fuzzy" type="button">模糊</button>
            <button class="quiet-btn mark-wrong" data-mark="wrong" type="button">错误</button>
          </div>
        </article>

        <aside class="detail-panel">
          <h2>词条详情</h2>
          <div class="detail-item">
            <div class="detail-label">中文释义</div>
            <p class="detail-value">${state.revealed ? escapeHtml(card.meaning) : "选择释义后显示"}</p>
          </div>
          ${state.revealed ? `
            ${synonyms ? `<div class="detail-item">
              <div class="detail-label">等价词 / 近义词</div>
              <p class="detail-value">${escapeHtml(synonyms)}</p>
            </div>` : ""}
            ${commonMeaning}
            <div class="detail-item">
              <div class="detail-label">助记</div>
              <p class="detail-value">${escapeHtml(card.mnemonic)}</p>
            </div>
            <div class="detail-item">
              <div class="detail-label">例句</div>
              <p class="detail-value">${escapeHtml(card.example)}</p>
            </div>
            <div class="detail-item">
              <div class="detail-label">来源</div>
              <p class="detail-value">${escapeHtml(card.source || "本地词库")}</p>
            </div>
          ` : `
            <div class="locked-note">先做中文释义选择，再看助记和例句。</div>
          `}
        </aside>
      </div>
    `;
  }

  function renderFeedback(card) {
    if (!state.revealed) {
      return `<div class="feedback">选择一个中文释义。</div>`;
    }

    if (state.selectedOption === null) {
      if (statusOf(card.id) === "fuzzy") {
        return `<div class="feedback">已标记模糊。先看正确释义、助记和例句，再进入下一词。</div>`;
      }
      return `<div class="feedback">已显示详情。</div>`;
    }

    const correct = state.selectedOption === card.meaning || state.selectedOption === null;
    return `
      <div class="feedback ${correct ? "good" : "bad"}">
        ${correct ? "正确。" : `正确释义：${escapeHtml(card.meaning)}`}
      </div>
    `;
  }

  function renderWordList(cards) {
    if (!cards.length) return "";
    return `
      <div class="word-list">
        ${cards.slice(0, 160).map((card, index) => {
          const status = statusOf(card.id);
          return `
            <button class="word-chip ${index === state.currentIndex ? "active" : ""}" data-jump="${index}" type="button">
              <span>${escapeHtml(card.word)}</span>
              <span class="status-dot ${status}"></span>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderPractice(type) {
    const items = filteredPracticeItems(type);
    const stats = practiceStats(type);
    const labels = {
      fill: "填空练习",
      math: "数学练习",
      reading: "阅读练习",
    };
    const target = document.getElementById(`view-${type}`);
    target.innerHTML = `
      <div class="metrics-grid">
        ${metricCard("题目总数", stats.total, labels[type])}
        ${metricCard("已完成", stats.done, `${stats.completion}%`)}
        ${metricCard("正确率", `${stats.accuracy}%`, `${stats.correct}/${stats.done || 0}`)}
        ${metricCard("错题/收藏", `${stats.wrong}/${stats.favorite}`, "错题 / 收藏")}
      </div>

      <div class="toolbar">
        <div class="toolbar-row">
          <span class="toolbar-label">题目队列</span>
          ${["all", "new", "wrong", "favorite"].map((mode) => `
            <button class="filter-btn ${state.practiceMode[type] === mode ? "active" : ""}" data-practice-mode="${mode}" data-practice-type="${type}" type="button">
              ${escapeHtml({ all: "全部", new: "未做", wrong: "错题", favorite: "收藏" }[mode])}
            </button>
          `).join("")}
        </div>
      </div>

      <section class="section-band">
        <div class="section-head">
          <h2>${labels[type]}</h2>
          <span class="section-meta">${items.length} 组；原创/改写练习，解析含重点词释义</span>
        </div>
        ${items.length ? `<div class="question-list">${items.map((item, index) => renderQuestion(type, item, index)).join("")}</div>` : '<div class="empty-state"><h2>当前队列为空</h2><p>切换筛选条件继续练习。</p></div>'}
      </section>
    `;
  }

  function renderQuestion(type, item, index) {
    if (type === "reading") {
      return `
        <article class="question-card">
          <div class="question-title"><span>Passage ${index + 1}</span><span>${(item.tags || []).map(escapeHtml).join(" / ")}</span></div>
          <div class="reading-passage">${escapeHtml(item.passage)}</div>
          ${item.questions.map((question, qIndex) => renderOptionQuestion(`${item.id}-q${qIndex + 1}`, question, qIndex, item.tags || [])).join("")}
        </article>
      `;
    }

    if (item.type === "two-blank") {
      const record = practiceRecord(item.id);
      const revealed = Boolean(record);
      const draft = state.practiceDrafts[item.id] || [];
      return `
        <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
          ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
          <p class="stem">${escapeHtml(item.stem)}</p>
          ${item.blanks.map((blank, blankIndex) => `
            <div class="blank-label">Blank ${blankIndex + 1}</div>
            <ul class="option-list">
              ${blank.map((option, optionIndex) => `
                <li><button class="${practiceOptionClass(item.id, optionIndex, item.answer[blankIndex], revealed, draft[blankIndex], blankIndex)}" data-blank-question="${escapeHtml(item.id)}" data-blank-index="${blankIndex}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button></li>
              `).join("")}
            </ul>
          `).join("")}
          <div class="question-actions">
            <button class="primary-btn" data-submit-blank="${escapeHtml(item.id)}" type="button">提交</button>
            <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
          </div>
          <div class="explanation">${renderResultLine(record)}答案：${item.answer.map((ans, i) => `Blank ${i + 1} ${String.fromCharCode(65 + ans)}`).join("；")}。${renderExplanationText(item.explanation)}</div>
        </article>
      `;
    }

    if (item.type === "sentence-equivalence") {
      const record = practiceRecord(item.id);
      const revealed = Boolean(record);
      const draft = state.practiceDrafts[item.id] || [];
      return `
        <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
          ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
          <p class="stem">${escapeHtml(item.stem)}</p>
          <ul class="option-list">
            ${item.options.map((option, optionIndex) => `
              <li><button class="${practiceOptionClass(item.id, optionIndex, item.answer, revealed, draft)}" data-toggle-question="${escapeHtml(item.id)}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button></li>
            `).join("")}
          </ul>
          <div class="question-actions">
            <button class="primary-btn" data-submit-toggle="${escapeHtml(item.id)}" type="button">提交</button>
            <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
          </div>
          <div class="explanation">${renderResultLine(record)}答案：${item.answer.map((ans) => String.fromCharCode(65 + ans)).join(", ")}。${renderExplanationText(item.explanation)}</div>
        </article>
      `;
    }

    const record = practiceRecord(item.id);
    const revealed = Boolean(record);
    return `
      <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
        ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
        <p class="stem">${escapeHtml(item.stem)}</p>
        <ul class="option-list">
          ${item.options.map((option, optionIndex) => `
            <li><button class="${practiceOptionClass(item.id, optionIndex, item.answer, revealed)}" data-practice="${escapeHtml(item.id)}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button></li>
          `).join("")}
        </ul>
        <div class="question-actions">
          <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
        </div>
        <div class="explanation">${renderResultLine(record)}答案：${answerLetters(item.answer)}。${renderExplanationText(item.explanation)}</div>
      </article>
    `;
  }

  function renderQuestionTopline(label, tags, id) {
    const record = practiceRecord(id);
    return `
      <div class="question-title">
        <span>${escapeHtml(label)}</span>
        <span>${(tags || []).map(escapeHtml).join(" / ")}</span>
      </div>
      <div class="question-actions compact">
        <span class="status-pill ${record?.status || "new"}">${escapeHtml({ correct: "正确", wrong: "错误", new: "未做" }[record?.status || "new"])}</span>
        <button class="quiet-btn ${record?.favorite ? "is-favorite" : ""}" data-favorite="${escapeHtml(id)}" type="button">${record?.favorite ? "已收藏" : "收藏"}</button>
        ${record ? `<button class="quiet-btn" data-redo="${escapeHtml(id)}" type="button">重做</button>` : ""}
      </div>
    `;
  }

  function renderOptionQuestion(id, question, qIndex, tags) {
    const record = practiceRecord(id);
    const revealed = Boolean(record);
    return `
      <div class="reading-question ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(id)}">
        ${renderQuestionTopline(`${qIndex + 1}. Reading Question`, tags, id)}
        <p class="stem">${qIndex + 1}. ${escapeHtml(question.q)}</p>
        <ul class="option-list">
          ${question.options.map((option, optionIndex) => `
            <li><button class="${practiceOptionClass(id, optionIndex, question.answer, revealed)}" data-reading="${escapeHtml(id)}" data-answer="${question.answer}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button></li>
          `).join("")}
        </ul>
        <div class="question-actions">
          <button class="ghost-btn" data-show-answer="${escapeHtml(id)}" type="button">查看解析</button>
        </div>
        <div class="explanation">${renderResultLine(record)}答案：${answerLetters(question.answer)}。${renderExplanationText(question.explanation)}</div>
      </div>
    `;
  }

  function answerLetters(answer) {
    return normalizeAnswer(answer).map((ans) => String.fromCharCode(65 + Number(ans))).join(", ");
  }

  function renderResultLine(record) {
    if (!record) return "";
    const label = record.status === "correct" ? "上次答对。" : "上次答错。";
    return `<strong>${label}</strong> `;
  }

  function practiceOptionClass(id, optionIndex, answer, revealed, draft = [], blankIndex = null) {
    const record = practiceRecord(id);
    const answers = normalizeAnswer(answer).map(Number);
    const selected = record?.selected || [];
    const draftSelected = Array.isArray(draft)
      ? (blankIndex === null ? draft.includes(optionIndex) : draft[blankIndex] === optionIndex)
      : false;
    const selectedForOption = blankIndex === null
      ? selected.includes(optionIndex)
      : selected[blankIndex] === optionIndex;
    const classes = [];

    if (!revealed && draftSelected) classes.push("selected");
    if (revealed && answers.includes(optionIndex)) classes.push("correct");
    if (revealed && selectedForOption && !answers.includes(optionIndex)) classes.push("wrong");
    return classes.join(" ");
  }

  function render() {
    if (state.view === "dashboard") renderDashboard();
    if (state.view === "vocab") renderVocab();
    if (state.view === "fill") renderPractice("fill");
    if (state.view === "math") renderPractice("math");
    if (state.view === "reading") renderPractice("reading");
  }

  function currentCard() {
    const cards = filteredCards();
    clampCurrent(cards);
    return cards[state.currentIndex];
  }

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      setView(nav.dataset.view);
      return;
    }

    const dashboardAction = event.target.closest("[data-dashboard-action]");
    if (dashboardAction) {
      if (dashboardAction.dataset.dashboardAction === "review") {
        state.deckId = "equiv";
        state.mode = "review";
        state.day = "all";
        resetCardSession();
        setView("vocab");
      } else if (dashboardAction.dataset.dashboardAction === "equiv-day1") {
        state.deckId = "equiv";
        state.mode = "all";
        state.day = "1";
        resetCardSession();
        setView("vocab");
      }
      return;
    }

    const deckBtn = event.target.closest("[data-deck]");
    if (deckBtn && !deckBtn.disabled) {
      state.deckId = deckBtn.dataset.deck;
      state.day = "all";
      resetCardSession();
      render();
      return;
    }

    const dayBtn = event.target.closest("[data-day]");
    if (dayBtn) {
      state.day = dayBtn.dataset.day;
      resetCardSession();
      render();
      return;
    }

    const modeBtn = event.target.closest("[data-mode]");
    if (modeBtn) {
      state.mode = modeBtn.dataset.mode;
      resetCardSession();
      render();
      return;
    }

    const practiceModeBtn = event.target.closest("[data-practice-mode]");
    if (practiceModeBtn) {
      state.practiceMode[practiceModeBtn.dataset.practiceType] = practiceModeBtn.dataset.practiceMode;
      render();
      return;
    }

    const choice = event.target.closest("[data-choice]");
    if (choice) {
      const card = currentCard();
      if (card && !state.revealed) {
        revealCard(card, choice.dataset.choice);
        render();
      }
      return;
    }

    const step = event.target.closest("[data-step]");
    if (step) {
      moveCard(Number(step.dataset.step));
      return;
    }

    const reveal = event.target.closest("[data-reveal]");
    if (reveal) {
      state.revealed = true;
      state.selectedOption = null;
      render();
      return;
    }

    const mark = event.target.closest("[data-mark]");
    if (mark) {
      const card = currentCard();
      if (card) {
        if (mark.dataset.mark === "fuzzy") {
          markCard(card, "fuzzy", null);
          state.revealed = true;
          state.selectedOption = null;
          render();
          return;
        }
        markCard(card, mark.dataset.mark, null);
        moveCard(1);
      }
      return;
    }

    const jump = event.target.closest("[data-jump]");
    if (jump) {
      state.currentIndex = Number(jump.dataset.jump);
      state.revealed = false;
      state.selectedOption = null;
      render();
      return;
    }

    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      toggleFavorite(favorite.dataset.favorite);
      return;
    }

    const redo = event.target.closest("[data-redo]");
    if (redo) {
      delete progress.practice[redo.dataset.redo];
      delete state.practiceDrafts[redo.dataset.redo];
      saveProgress();
      render();
      return;
    }

    const practice = event.target.closest("[data-practice]");
    if (practice) {
      answerPracticeQuestion(practice.dataset.practice, [Number(practice.dataset.optionIndex)]);
      return;
    }

    const reading = event.target.closest("[data-reading]");
    if (reading) {
      answerPracticeQuestion(reading.dataset.reading, [Number(reading.dataset.optionIndex)]);
      return;
    }

    const toggleOption = event.target.closest("[data-toggle-question]");
    if (toggleOption) {
      toggleDraftOption(toggleOption.dataset.toggleQuestion, Number(toggleOption.dataset.optionIndex), 2);
      return;
    }

    const submitToggle = event.target.closest("[data-submit-toggle]");
    if (submitToggle) {
      submitDraftAnswer(submitToggle.dataset.submitToggle);
      return;
    }

    const blankOption = event.target.closest("[data-blank-question]");
    if (blankOption) {
      selectBlankOption(blankOption.dataset.blankQuestion, Number(blankOption.dataset.blankIndex), Number(blankOption.dataset.optionIndex));
      return;
    }

    const submitBlank = event.target.closest("[data-submit-blank]");
    if (submitBlank) {
      submitDraftAnswer(submitBlank.dataset.submitBlank);
      return;
    }

    const showAnswer = event.target.closest("[data-show-answer]");
    if (showAnswer) {
      showPracticeAnswer(showAnswer.dataset.showAnswer);
      return;
    }

    if (event.target.id === "exportBtn") {
      exportProgress();
      return;
    }

    if (event.target.id === "resetBtn") {
      if (confirm("确认重置本地学习进度？")) {
        progress = { cards: {}, practice: {} };
        saveProgress();
        resetCardSession();
        render();
      }
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "wordSearch") return;
    const cursor = event.target.selectionStart;
    state.query = event.target.value;
    resetCardSession();
    render();
    const input = document.getElementById("wordSearch");
    if (input) {
      input.focus();
      input.setSelectionRange(cursor, cursor);
    }
  });

  function findPracticeQuestion(id) {
    const direct = ["fill", "math"].flatMap((type) => data.practice[type] || []).find((item) => item.id === id);
    if (direct) return direct;
    return allPracticeQuestions("reading").find((item) => item.id === id);
  }

  function answerPracticeQuestion(id, selected) {
    const question = findPracticeQuestion(id);
    if (!question || practiceRecord(id)) return;
    savePracticeAnswer(id, selected, question.answer);
    render();
  }

  function toggleDraftOption(id, optionIndex, maxCount) {
    if (practiceRecord(id)) return;
    const current = state.practiceDrafts[id] || [];
    const exists = current.includes(optionIndex);
    const next = exists
      ? current.filter((value) => value !== optionIndex)
      : [...current, optionIndex].slice(-maxCount);
    state.practiceDrafts[id] = next;
    render();
  }

  function selectBlankOption(id, blankIndex, optionIndex) {
    if (practiceRecord(id)) return;
    const current = state.practiceDrafts[id] || [];
    current[blankIndex] = optionIndex;
    state.practiceDrafts[id] = current;
    render();
  }

  function submitDraftAnswer(id) {
    const question = findPracticeQuestion(id);
    if (!question || practiceRecord(id)) return;
    const draft = state.practiceDrafts[id] || [];
    const expected = normalizeAnswer(question.answer).length;
    const complete = draft.length >= expected && draft.slice(0, expected).every((value) => Number.isInteger(value));

    if (!complete) {
      alert("请先选完整答案。");
      return;
    }

    savePracticeAnswer(id, draft.slice(0, expected), question.answer);
    delete state.practiceDrafts[id];
    render();
  }

  function showPracticeAnswer(id) {
    const question = findPracticeQuestion(id);
    if (!question) return;
    if (!practiceRecord(id)) {
      savePracticeAnswer(id, [], question.answer);
    }
    render();
  }

  function toggleFavorite(id) {
    const current = progress.practice[id] || {
      attempts: 0,
      correct: 0,
      status: "new",
      selected: [],
      favorite: false,
    };
    current.favorite = !current.favorite;
    current.updatedAt = new Date().toISOString();
    progress.practice[id] = current;
    saveProgress();
    render();
  }

  function exportProgress() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), progress }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gre-progress.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  render();
}());
