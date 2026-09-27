(function () {
  const data = window.GRE_DATA;
  const originalPractice = window.GRE_ORIGINAL_PRACTICE;
  const originalMathPractice = window.GRE_ORIGINAL_MATH_PRACTICE;
  const generatedExplanations = window.GRE_EXPLANATIONS || { fill: {}, passages: {}, reading: {} };
  const optionMeanings = window.GRE_OPTION_MEANINGS?.meanings || {};
  const readingLookupMeanings = window.GRE_READING_LOOKUP_MEANINGS?.meanings || {};
  const sourceExamples = window.GRE_SOURCE_EXAMPLES?.examples || {};
  const curatedVocabulary = window.GRE_CURATED_VOCABULARY || { words: {}, cards: {}, excludedCards: [] };
  const curatedWords = curatedVocabulary.words || {};
  const curatedCards = curatedVocabulary.cards || {};
  const excludedCardIds = new Set(curatedVocabulary.excludedCards || []);
  if (originalPractice) {
    data.practice.fill = originalPractice.fill || [];
    data.practice.reading = originalPractice.reading || [];
    data.originalPractice = originalPractice;
  }
  if (originalMathPractice) {
    data.practice.math = originalMathPractice.math || [];
    data.originalMathPractice = originalMathPractice;
  }
  data.practice.math = (data.practice.math || []).filter((item) =>
    (item.tags || []).some((tag) => /medium|hard|中等|难题|高难/i.test(String(tag)))
  );
  const storageKey = "gre-prep-console-v1";

  const titles = {
    dashboard: ["Overview", "总览"],
    vocab: ["Vocabulary", "背词"],
    wordbook: ["Personal Wordbook", "生词本"],
    fill: ["Verbal", "填空"],
    math: ["Quant", "数学"],
    reading: ["Reading", "阅读"],
    section: ["Verbal Section", "Section 练习"],
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
    practicePage: { fill: 0, math: 0, reading: 0 },
    practiceDrafts: {},
    openStemLookup: null,
    sectionIndex: 0,
    wordbookMode: "unreviewed",
    wordbookSource: "all",
    wordbookQuery: "",
    wordbookPage: 0,
  };

  let progress = loadProgress();
  saveProgress();
  let cachedQuestionVocabulary = null;
  let cachedQuestionWordFrequency = null;
  let cachedRescueWordSet = null;
  let cachedStemDictionaryEntries = null;
  let cachedReadingStemDictionaryEntries = null;
  let cachedMathStemDictionaryEntries = null;
  let cachedMeaningIndex = null;

  function emptyProgress() {
    return { cards: {}, practice: {}, wordbook: {} };
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeProgress(value) {
    if (!isRecord(value) || !isRecord(value.cards) || !isRecord(value.practice)) return null;
    if (value.wordbook !== undefined && !isRecord(value.wordbook)) return null;
    return {
      cards: value.cards,
      practice: value.practice,
      wordbook: value.wordbook || {},
    };
  }

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      return normalizeProgress(saved) || emptyProgress();
    } catch (error) {
      return emptyProgress();
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

  function cleanChoiceMeaning(value) {
    return String(value ?? "")
      .replace(/^[（(]\s*(?:adj|adv|n|v|prep|conj|pron)\.?\s*[）)]\s*/i, "")
      .replace(/[（(]\s*(?:补充含义|非仅?[^\uff09)]*|(?:adj|adv|n|v|prep|conj|pron)\.?[^\uff09)]*)[）)]/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function withSourceExample(card) {
    const enriched = curatedCards[card.id];
    if (enriched) {
      return {
        ...card,
        studyMeaning: enriched.meaning,
        englishDefinition: enriched.englishDefinition,
        example: enriched.example,
        exampleSource: "词义对应例句",
      };
    }
    const located = sourceExamples[card.id];
    if (!located) {
      return {
        ...card,
        example: "当前导入的填空与阅读原题中未找到该词的完整原句。",
        exampleSource: "原题中未找到",
      };
    }
    return { ...card, example: located.text, exampleSource: located.source };
  }

  function renderExplanationText(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function renderVocabulary(items) {
    if (!Array.isArray(items) || !items.length) return '<p class="analysis-empty">本题没有额外标注的重点生词。</p>';
    return `<dl class="analysis-vocab">${items.map((item) => `
      <div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.meaning)}</dd></div>
    `).join("")}</dl>`;
  }

  function renderGeneratedAnalysis(id, fallback, kind = "fill") {
    const item = generatedExplanations[kind]?.[id];
    if (!item) {
      return `<div class="analysis-pending">本地资料暂无完整解析；当前仅有答案来源：${renderExplanationText(fallback)}</div>`;
    }
    if (kind === "reading") {
      const optionTranslations = Array.isArray(item.option_translations) && item.option_translations.length
        ? `<ol class="analysis-options" type="A">${item.option_translations.map((option) => `<li>${escapeHtml(option)}</li>`).join("")}</ol>`
        : "";
      const optionAnalysis = Array.isArray(item.option_analysis) && item.option_analysis.length
        ? `<div class="analysis-option-breakdown">${item.option_analysis.map((option) => `
            <div class="analysis-option-row ${option.verdict === "正确" ? "is-correct" : ""}">
              <strong>${escapeHtml(option.label)}. ${escapeHtml(option.verdict)}</strong>
              <p>${renderExplanationText(option.explanation)}</p>
            </div>
          `).join("")}</div>`
        : "";
      return `
        <section class="analysis-block">
          <h4>题目翻译</h4>
          <p>${renderExplanationText(item.question_translation)}</p>
          ${optionTranslations ? `<h4>选项翻译</h4>${optionTranslations}` : ""}
          <h4>本题生词</h4>
          ${renderVocabulary(item.vocabulary)}
          ${item.question_type ? `<h4>题型与任务</h4><p>${renderExplanationText(item.question_type)}</p>` : ""}
          ${item.passage_logic ? `<h4>文章结构与定位</h4><p>${renderExplanationText(item.passage_logic)}</p>` : ""}
          <h4>原文依据</h4>
          <p>${renderExplanationText(item.evidence)}</p>
          <h4>完整推理</h4>
          <p>${renderExplanationText(item.reasoning)}</p>
          ${optionAnalysis ? `<h4>逐项分析</h4>${optionAnalysis}` : ""}
          ${item.takeaway ? `<h4>本题易错点</h4><p>${renderExplanationText(item.takeaway)}</p>` : ""}
        </section>
      `;
    }
    return `
      <section class="analysis-block">
        <h4>完整翻译</h4>
        <p>${renderExplanationText(item.translation)}</p>
        <h4>生词释义</h4>
        ${renderVocabulary(item.vocabulary)}
        <h4>为什么选这个</h4>
        <p>${renderExplanationText(item.reasoning)}</p>
        <h4>干扰项排除</h4>
        <p>${renderExplanationText(item.distractors)}</p>
      </section>
    `;
  }

  function renderPracticeAnalysis(type, item) {
    if (type === "math") {
      return `
        <section class="analysis-block">
          <h4>简明解析</h4>
          <p>${renderExplanationText(item.explanation || "暂无解析。")}</p>
        </section>
      `;
    }
    return renderGeneratedAnalysis(item.id, item.explanation);
  }

  function renderPassageAnalysis(passageId, revealed = false) {
    if (!revealed) return "";
    const item = generatedExplanations.passages?.[passageId];
    if (!item) return '<p class="analysis-pending">本地资料暂无全文翻译与篇章生词。</p>';
    return `
      <details class="passage-analysis" open>
        <summary>全文翻译与篇章生词</summary>
        <section class="analysis-block">
          <h4>全文翻译</h4>
          <p>${renderExplanationText(item.translation)}</p>
          <h4>篇章生词</h4>
          ${renderVocabulary(item.vocabulary)}
        </section>
      </details>
    `;
  }

  const questionStopWords = new Set(`
    a an and are as at be been being but by can could did do does doing done for from had has have having
    he her hers him his how i if in into is it its itself may might more most much must my no nor not of on
    one only or other our ours out over own same she should so some such than that the their theirs them
    themselves then there these they this those through to too under until up very was we were what when
    where which while who whom whose why will with would you your yours also although because before after
    even ever however indeed instead less many merely neither nevertheless often once perhaps rather since
    still therefore though thus yet any both each either enough every few all almost among another around
    between during per via within without passage question questions answer answers blank blanks choice
    choices following according primarily concerned likely best suggests indicate indicated implies imply
    except phrase line lines author authors paragraph text statement statements true false
    about new work works worked working people person persons woman women man men first second third
    year years time times two three four five made make makes making found find finds finding used use uses
    using life lives state states united american iii
  `.trim().split(/\s+/));

  function normalizeWord(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/^[^a-z]+|[^a-z'-]+$/g, "")
      .replace(/'s$/, "");
  }

  function optionMeaningFor(option) {
    return optionMeanings[normalizeWord(option)] || "释义待补充";
  }

  function optionWordbookTerm(option) {
    return normalizeWord(option).replace(/^(?:a|an|the)\s+/, "");
  }

  function isRescueWord(word) {
    if (!cachedRescueWordSet) cachedRescueWordSet = new Set(rescueWords());
    return cachedRescueWordSet.has(normalizeWord(word));
  }

  function renderOptionStudy(option, revealed, item) {
    if (!revealed) return "";
    const optionKey = normalizeWord(option);
    const word = optionWordbookTerm(option);
    const meaning = optionMeaningFor(option);
    const alwaysIncluded = isRescueWord(word);
    const added = alwaysIncluded || wordbookStatus(word) === "unknown";
    const label = alwaysIncluded ? "已在救命800词" : (added ? "已加入生词本" : "加入生词本");
    return `
      <div class="option-study">
        <span class="option-meaning">${escapeHtml(meaning)}</span>
        <button class="option-wordbook-btn ${added ? "added" : ""}" data-option-wordbook="${escapeHtml(word)}" data-option-key="${escapeHtml(optionKey)}" data-option-item="${escapeHtml(item.id)}" type="button" ${alwaysIncluded ? "disabled" : ""}>${escapeHtml(label)}</button>
      </div>
    `;
  }

  const basicLookupWords = new Set(`
    ability about according action actual agree allow amount analysis answer appear approach area argument
    article author available because become before belief book business cause change choice collect collecting
    common company conclusion condition consider context correct create current data describe development
    different difficult effect emphasize evidence example explain fact field following general group history
    idea important improve include increase indicate information insist interest issue knowledge known language
    likely major matter meaning method model modern nature necessary normal occur offer often particular people
    period person political possible present problem process produce public purpose question reason recovery
    relation research result science scientific secret secrets seem significant simple social society source
    specific statement study support suggest surprise system term theory time true type use value volume way work
    world writer economic empire framework reliability committee committees legend legends cave caves
    adult age air animal arrive begin believe better build career carry child children close country course
    decide deep differ document early earth easy eat eaten establish established family feel focus focused food
    form friend friendship grow happen house human individual investigate investigating large later learn
    learning life little long make mean means member move never new old open original pattern place regarding role
    plant popular remain school show small start state story student sure together understand water woman young
    species studies study begun
  `.trim().split(/\s+/));

  const shortGreLookupWords = new Set(`
    abet abeyance belie boon cogent dearth deft dogma enigma gainsay guile hubris laconic lucid moot myopic
    nascent opaque overt paradox pithy placid rife spurn tacit terse tractable venal virtue wont zeal
    ambivalent apathetic ardent austere cynical disdainful dismissive dubious earnest ecstatic hostile
    indifferent ironic jubilant lament skeptical wary endorse undermine bolster buttress concede contend
    decry denounce deplore disparage extol laud rebuff refute repudiate resent scorn shore shoring
  `.trim().split(/\s+/));

  function isDifficultLookupTerm(term) {
    const words = wordsIn(term).filter((word) => !questionStopWords.has(word));
    if (!words.length) return false;
    if (words.some((word) => shortGreLookupWords.has(word) || isRescueWord(word))) return true;
    return words.some((word) => !basicLookupWords.has(word));
  }

  function stemDictionaryEntries() {
    if (cachedStemDictionaryEntries) return cachedStemDictionaryEntries;
    const supplemental = [
      { term: "shoring up", meaning: "支撑；巩固；加强" },
      { term: "shore up", meaning: "支撑；巩固；加强" },
    ];
    const orderedDecks = [rescueDeck(), ...data.decks.filter((deck) => deck.id !== "core")];
    const fromDecks = orderedDecks.flatMap((deck) => (deck.cards || []).map((card) => ({
      term: card.word,
      meaning: card.meaning,
    })));
    const fromGreOptions = Object.entries(optionMeanings).map(([term, meaning]) => ({ term, meaning }));
    const seen = new Set();
    cachedStemDictionaryEntries = [...supplemental, ...fromDecks, ...fromGreOptions].filter((entry) => {
      const key = normalizeWord(entry.term);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return cachedStemDictionaryEntries;
  }

  function readingStemDictionaryEntries() {
    if (cachedReadingStemDictionaryEntries) return cachedReadingStemDictionaryEntries;
    const supplemental = [
      { term: "shoring up", meaning: "支撑；巩固；加强" },
      { term: "shore up", meaning: "支撑；巩固；加强" },
    ];
    const rescueEntries = rescueDeck().cards.map((card) => ({ term: card.word, meaning: card.meaning }));
    const generatedEntries = Object.entries(readingLookupMeanings).map(([term, meaning]) => ({ term, meaning }));
    const seen = new Set();
    cachedReadingStemDictionaryEntries = [...supplemental, ...rescueEntries, ...generatedEntries].filter((entry) => {
      const key = normalizeWord(entry.term);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return cachedReadingStemDictionaryEntries;
  }

  function mathStemDictionaryEntries() {
    if (cachedMathStemDictionaryEntries) return cachedMathStemDictionaryEntries;
    const basicMathTerms = new Set(["positive", "negative", "number", "line", "point", "circle", "square", "triangle", "percent"]);
    cachedMathStemDictionaryEntries = (window.GRE_MATH_VOCAB || [])
      .map((term) => ({ term: String(term.word || "").trim(), meaning: term.meaning || "" }))
      .filter((term) => term.term && term.meaning && !basicMathTerms.has(normalizeWord(term.term)))
      .sort((left, right) => right.term.length - left.term.length);
    return cachedMathStemDictionaryEntries;
  }

  function lookupMeaningIndex() {
    if (!cachedMeaningIndex) cachedMeaningIndex = buildMeaningIndex();
    return cachedMeaningIndex;
  }

  function derivedLookupEntries(text) {
    const meanings = lookupMeaningIndex();
    return wordsIn(text).map((word) => ({
      term: word,
      meaning: wordMeaning(word, meanings),
    })).filter((entry) => entry.meaning);
  }

  function stemLookupEntries(text, id, kind) {
    const dictionaryEntries = kind === "math"
      ? mathStemDictionaryEntries()
      : (kind === "reading" ? readingStemDictionaryEntries() : stemDictionaryEntries());
    const vocabulary = [
      ...(generatedExplanations[kind]?.[id]?.vocabulary || []),
      ...(kind === "fill" ? derivedLookupEntries(text) : []),
      ...dictionaryEntries,
    ];
    const lowerText = String(text || "").toLowerCase();
    const seen = new Set();
    return vocabulary
      .map((entry) => ({ ...entry, term: String(entry.term || "").trim() }))
      .filter((entry) => {
        const key = normalizeWord(entry.term);
        if (!key || seen.has(key)) return false;
        if (!lowerText.includes(entry.term.toLowerCase())) return false;
        if (kind !== "math" && wordbookStatus(key) === "known") return false;
        if (kind !== "math" && !isDifficultLookupTerm(entry.term)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => right.term.length - left.term.length);
  }

  function renderStemPopover(entry, id, kind) {
    const word = normalizeWord(entry.term);
    if (kind === "math") {
      return `
        <span class="stem-lookup-popover math-term-popover" role="status">
          <strong>${escapeHtml(entry.term)}</strong>
          <span>${escapeHtml(entry.meaning)}</span>
        </span>
      `;
    }
    const alwaysIncluded = isRescueWord(word);
    const added = alwaysIncluded || wordbookStatus(word) === "unknown";
    return `
      <span class="stem-lookup-popover" role="status">
        <strong>${escapeHtml(entry.term)}</strong>
        <span>${escapeHtml(entry.meaning)}</span>
        <span class="stem-lookup-actions">
          <button data-stem-add="${escapeHtml(word)}" data-stem-item="${escapeHtml(id)}" data-stem-kind="${escapeHtml(kind)}" type="button" ${alwaysIncluded ? "disabled" : ""}>${alwaysIncluded ? "已在救命800词" : (added ? "已加入生词本" : "加入生词本")}</button>
          <button data-stem-known="${escapeHtml(word)}" type="button">认识，今后隐藏</button>
        </span>
      </span>
    `;
  }

  function renderLookupStem(text, id, revealed, kind = "fill", scope = "stem") {
    if (!revealed) return escapeHtml(text);
    const entries = stemLookupEntries(text, id, kind);
    if (!entries.length) return escapeHtml(text);
    const source = String(text || "");
    const lowerSource = source.toLowerCase();
    const matches = [];
    entries.forEach((entry) => {
      const needle = entry.term.toLowerCase();
      let from = 0;
      while (from < lowerSource.length) {
        const start = lowerSource.indexOf(needle, from);
        if (start < 0) break;
        const end = start + needle.length;
        const before = source[start - 1] || "";
        const after = source[end] || "";
        if (!/[A-Za-z]/.test(before) && !/[A-Za-z]/.test(after)) matches.push({ start, end, entry });
        from = Math.max(end, start + 1);
      }
    });
    matches.sort((left, right) => left.start - right.start || right.end - left.end);
    const accepted = [];
    matches.forEach((match) => {
      if (!accepted.length || match.start >= accepted[accepted.length - 1].end) accepted.push(match);
    });
    if (!accepted.length) return escapeHtml(text);

    let cursor = 0;
    let output = "";
    accepted.forEach((match) => {
      output += escapeHtml(source.slice(cursor, match.start));
      const key = normalizeWord(match.entry.term);
      const position = `${scope}:${match.start}`;
      const open = state.openStemLookup?.id === id
        && state.openStemLookup?.word === key
        && state.openStemLookup?.position === position;
      output += `<span class="stem-lookup-wrap"><button class="stem-lookup-word" data-stem-lookup="${escapeHtml(key)}" data-stem-item="${escapeHtml(id)}" data-stem-kind="${escapeHtml(kind)}" data-stem-position="${escapeHtml(position)}" type="button">${escapeHtml(source.slice(match.start, match.end))}</button>${open ? renderStemPopover(match.entry, id, kind) : ""}</span>`;
      cursor = match.end;
    });
    output += escapeHtml(source.slice(cursor));
    return output;
  }

  function wordsIn(value) {
    return (String(value || "").match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) || [])
      .map(normalizeWord)
      .filter(Boolean);
  }

  function rescueDeck() {
    return data.decks.find((deck) => deck.id === "core") || { cards: [] };
  }

  function rescueWords() {
    return rescueDeck().cards
      .filter((card) => !excludedCardIds.has(card.id))
      .map((card) => normalizeWord(card.word));
  }

  function questionWordFrequency() {
    if (cachedQuestionWordFrequency) return cachedQuestionWordFrequency;
    const frequency = new Map();
    const collect = (text) => wordsIn(text).forEach((word) => {
      if (word.length < 3 || questionStopWords.has(word)) return;
      frequency.set(word, (frequency.get(word) || 0) + 1);
    });
    (data.practice.fill || []).forEach((item) => {
      collect(item.stem);
      (item.options || []).forEach(collect);
      (item.blanks || []).flat().forEach(collect);
    });
    (data.practice.reading || []).forEach((passage) => {
      collect(passage.passage);
      passage.questions.forEach((question) => {
        collect(question.q);
        question.options.forEach(collect);
      });
    });
    cachedQuestionWordFrequency = frequency;
    return frequency;
  }

  function buildMeaningIndex() {
    const meanings = new Map();
    data.decks.forEach((deck) => {
      deck.cards.forEach((card) => {
        const word = normalizeWord(card.word);
        if (word && card.meaning && !meanings.has(word)) meanings.set(word, card.meaning);
      });
    });

    const explanations = [
      ...(data.practice.fill || []).map((item) => item.explanation),
      ...(data.practice.reading || []).flatMap((passage) => passage.questions.map((question) => question.explanation)),
    ];
    explanations.forEach((explanation) => {
      String(explanation || "").split(/[\uff1b\n]/).forEach((part) => {
        const match = part.match(/([A-Za-z][A-Za-z'-]*)=([^\uff1b\n]+)/);
        if (!match) return;
        const word = normalizeWord(match[1]);
        if (word && !meanings.has(word)) meanings.set(word, match[2].trim());
      });
    });

    const generatedVocabulary = [
      ...Object.values(generatedExplanations.fill || {}).flatMap((item) => item.vocabulary || []),
      ...Object.values(generatedExplanations.passages || {}).flatMap((item) => item.vocabulary || []),
      ...Object.values(generatedExplanations.reading || {}).flatMap((item) => item.vocabulary || []),
    ];
    generatedVocabulary.forEach((item) => {
      const term = String(item.term || "").trim();
      if (!/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(term)) return;
      const word = normalizeWord(term);
      if (word && item.meaning && !meanings.has(word)) meanings.set(word, item.meaning);
    });
    return meanings;
  }

  function wordMeaning(word, meanings) {
    if (meanings.has(word)) return meanings.get(word);
    const stems = [];
    if (word.endsWith("ies") && word.length > 4) stems.push(`${word.slice(0, -3)}y`);
    if (word.endsWith("ing") && word.length > 5) stems.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
    if (word.endsWith("ed") && word.length > 4) stems.push(word.slice(0, -2), word.slice(0, -1));
    if (word.endsWith("es") && word.length > 4) stems.push(word.slice(0, -2), word.slice(0, -1));
    if (word.endsWith("s") && word.length > 3) stems.push(word.slice(0, -1));
    const base = stems.find((stem) => meanings.has(stem));
    return base ? meanings.get(base) : "";
  }

  function contextFor(text, word) {
    const pieces = String(text || "").split(/(?<=[.!?])\s+/);
    const found = pieces.find((piece) => piece.toLowerCase().includes(word));
    const context = (found || String(text || "")).trim();
    return context.length > 240 ? `${context.slice(0, 237)}...` : context;
  }

  function questionVocabulary() {
    if (cachedQuestionVocabulary) return cachedQuestionVocabulary;
    const rescueSet = new Set(rescueWords());
    const meanings = buildMeaningIndex();
    const candidates = new Map();

    function collect(text, source, itemId) {
      wordsIn(text).forEach((word) => {
        if (word.length < 3 || questionStopWords.has(word) || rescueSet.has(word)) return;
        const curated = curatedWords[word];
        if (!curated) return;
        const existing = candidates.get(word) || {
          word,
          meaning: curated.meaning || wordMeaning(word, meanings),
          englishDefinition: curated.englishDefinition || "",
          generatedExample: curated.example || "",
          level: curated.level || "",
          count: 0,
          sources: new Set(),
          contexts: [],
          itemIds: new Set(),
        };
        existing.count += 1;
        existing.sources.add(source);
        existing.itemIds.add(itemId);
        const context = contextFor(text, word);
        if (context && !existing.contexts.includes(context) && existing.contexts.length < 2) existing.contexts.push(context);
        candidates.set(word, existing);
      });
    }

    (data.practice.fill || []).forEach((item) => {
      collect(item.stem, "fill", item.id);
      (item.options || []).forEach((option) => collect(option, "fill", item.id));
      (item.blanks || []).flat().forEach((option) => collect(option, "fill", item.id));
    });
    (data.practice.reading || []).forEach((passage) => {
      collect(passage.passage, "reading", passage.id);
      passage.questions.forEach((question, index) => {
        const id = `${passage.id}-q${index + 1}`;
        collect(question.q, "reading", id);
        question.options.forEach((option) => collect(option, "reading", id));
      });
    });

    Object.entries(progress.wordbook).forEach(([word, entry]) => {
      if (!entry?.manual) return;
      const existing = candidates.get(word);
      if (existing) {
        if (!existing.meaning && entry.meaning) existing.meaning = entry.meaning;
        return;
      }
      candidates.set(word, {
        word,
        meaning: entry.meaning || "",
        count: 1,
        sources: new Set([entry.source || "fill"]),
        contexts: entry.context ? [entry.context] : [],
        itemIds: new Set(entry.itemId ? [entry.itemId] : []),
      });
    });

    cachedQuestionVocabulary = [...candidates.values()]
      .map((item) => ({ ...item, sources: [...item.sources], itemIds: [...item.itemIds] }))
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.word.localeCompare(right.word);
      });
    return cachedQuestionVocabulary;
  }

  function wordbookStatus(word) {
    return progress.wordbook[word]?.status || "unreviewed";
  }

  function wordbookStats() {
    const candidates = questionVocabulary();
    const stats = { total: candidates.length, unreviewed: 0, unknown: 0, known: 0 };
    candidates.forEach((candidate) => { stats[wordbookStatus(candidate.word)] += 1; });
    stats.rescue = rescueWords().length;
    stats.exportTotal = new Set([
      ...rescueWords(),
      ...candidates.filter((candidate) => wordbookStatus(candidate.word) === "unknown").map((candidate) => candidate.word),
    ]).size;
    return stats;
  }

  function filteredQuestionVocabulary() {
    const query = state.wordbookQuery.trim().toLowerCase();
    return questionVocabulary().filter((candidate) => {
      const status = wordbookStatus(candidate.word);
      if (state.wordbookMode !== "all" && status !== state.wordbookMode) return false;
      if (state.wordbookSource !== "all" && !candidate.sources.includes(state.wordbookSource)) return false;
      if (!query) return true;
      return [candidate.word, candidate.meaning, candidate.englishDefinition, ...candidate.contexts].join(" ").toLowerCase().includes(query);
    });
  }

  function personalCardId(word) {
    return `personal-${normalizeWord(word)}`;
  }

  function personalWordbookCards() {
    return questionVocabulary()
      .filter((candidate) => wordbookStatus(candidate.word) === "unknown")
      .map((candidate) => ({
        id: personalCardId(candidate.word),
        word: candidate.word,
        meaning: candidate.meaning || "题库词表暂无中文释义",
        studyMeaning: candidate.meaning || "题库词表暂无中文释义",
        englishDefinition: candidate.englishDefinition || "",
        mnemonic: `这个词在当前填空与阅读题库中共出现 ${candidate.count} 次。`,
        example: candidate.generatedExample || candidate.contexts[0] || "",
        exampleSource: "词义对应例句",
        source: candidate.sources.map((source) => source === "fill" ? "填空" : "阅读").join(" + "),
        tags: ["个人生词", `题库出现 ${candidate.count} 次`],
        occurrenceCount: candidate.count,
      }))
      .sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.word.localeCompare(right.word));
  }

  function personalDeck() {
    return {
      id: "personal",
      name: "个人生词本",
      description: "从填空与阅读中加入的生词，按题库出现次数降序。",
      cards: personalWordbookCards(),
    };
  }

  function availableDecks() {
    return [
      ...data.decks.map((deck) => ({
        ...deck,
        cards: deck.cards.filter((card) => !excludedCardIds.has(card.id)).map(withSourceExample),
      })),
      personalDeck(),
    ];
  }

  function getDeck(id) {
    return availableDecks().find((deck) => deck.id === id) || data.decks[0];
  }

  function learnableDecks() {
    return availableDecks().filter((deck) => !deck.locked);
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

  function isCardInReview(cardOrId) {
    const cardId = typeof cardOrId === "string" ? cardOrId : cardOrId.id;
    const record = cardProgress(cardId);
    if (record?.inReviewPool === true) return true;
    if (record?.inReviewPool === false) return false;
    if (cardId.startsWith("personal-") && record === null) return true;
    return ["wrong", "fuzzy"].includes(record?.status);
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
    let review = 0;
    let attempts = 0;
    let correct = 0;

    cards.forEach((card) => {
      const item = progress.cards[card.id];
      if (isCardInReview(card.id)) review += 1;
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
      review,
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

  function practiceSubmittedRecord(record) {
    if (!record) return false;
    if (record.submitted === true) return true;
    if (record.submitted === false) return false;
    return Array.isArray(record.selected) && record.selected.length > 0;
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
    const a = [...normalizeAnswer(left)].map(Number).sort((x, y) => x - y);
    const b = [...normalizeAnswer(right)].map(Number).sort((x, y) => x - y);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function sameOrderedAnswer(left, right) {
    const a = normalizeAnswer(left).map(Number);
    const b = normalizeAnswer(right).map(Number);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function savePracticeAnswer(id, selected, answer, ordered = false, submitted = true) {
    const correct = ordered ? sameOrderedAnswer(selected, answer) : sameAnswer(selected, answer);
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
    previous.submitted = submitted;
    previous.updatedAt = new Date().toISOString();
    progress.practice[id] = previous;
    saveProgress();
    return correct;
  }

  function filteredCards() {
    const deck = getDeck(state.deckId);
    const query = state.query.trim().toLowerCase();
    const frequency = questionWordFrequency();
    let cards = deck.cards
      .filter((card) => !card.needsGeneration)
      .map((card) => ({
        ...card,
        occurrenceCount: Number.isFinite(card.occurrenceCount)
          ? card.occurrenceCount
          : (frequency.get(normalizeWord(card.word)) || 0),
      }))
      .sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.word.localeCompare(right.word));

    if (state.day !== "all") {
      cards = cards.filter((card) => String(card.day) === String(state.day));
    }

    if (state.mode === "new") {
      cards = cards.filter((card) => statusOf(card.id) === "new");
    } else if (state.mode === "review") {
      cards = cards.filter((card) => isCardInReview(card));
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
    const wasInReview = isCardInReview(card);
    const current = progress.cards[card.id] || {
      attempts: 0,
      correct: 0,
      status: "new",
      history: [],
    };

    const wasQuizAttempt = selectedCorrect !== null;
    current.status = status;
    if (["wrong", "fuzzy"].includes(status)) current.inReviewPool = true;
    else if (wasInReview) current.inReviewPool = true;
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

  function removeCardFromReview(card) {
    const current = progress.cards[card.id] || {
      attempts: 0,
      correct: 0,
      status: "new",
      history: [],
    };
    current.inReviewPool = false;
    current.updatedAt = new Date().toISOString();
    progress.cards[card.id] = current;
    saveProgress();
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
    state.openStemLookup = null;
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
    const due = stats.review;
    const practiceCards = [
      ["fill", "填空", "单空、双空、六选二"],
      ["math", "数学", "仅保留易错的中等偏上与难题"],
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
          <span class="section-meta">填空2000题 + 阅读440篇原始资料；本地记录正确、错误、收藏</span>
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
          <article class="module-card">
            <h3>个人生词本</h3>
            <p>救命800词 + 你从阅读和填空中亲自选出的生词。</p>
            <button class="primary-btn" data-dashboard-action="wordbook" type="button">去筛选并导出</button>
          </article>
        </div>
      </section>
    `;
  }

  function renderDeckButtons() {
    return availableDecks()
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
        ${metricCard("复习池", deckStats.review, "只有手动移除才会离开")}
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
        <h2>${locked ? "词条资料不完整" : "当前队列为空"}</h2>
        <p>${locked ? "这批词只有英文原词，当前本地数据缺少释义、助记和例句。" : "切换队列或清空搜索条件后继续。"}</p>
      </div>
    `;
  }

  function renderWordbook() {
    const stats = wordbookStats();
    const candidates = filteredQuestionVocabulary();
    const pageSize = 60;
    const pageCount = Math.max(1, Math.ceil(candidates.length / pageSize));
    state.wordbookPage = Math.max(0, Math.min(state.wordbookPage, pageCount - 1));
    const pageStart = state.wordbookPage * pageSize;
    const pageItems = candidates.slice(pageStart, pageStart + pageSize);

    document.getElementById("view-wordbook").innerHTML = `
      <div class="wordbook-intro">
        <div>
          <p class="eyebrow">PERSONAL FILTER</p>
          <h2>只导出你真正要背的词</h2>
          <p>GRE 救命800词中的有效词条已默认纳入（已剔除 1 条 OCR 残片）。下面是从填空题干、填空选项、阅读文章、阅读题干和选项中提取并严格过滤后的候选词：你只需把不熟的标为“加入生词本”，熟词标为“认识”。</p>
        </div>
        <button class="primary-btn export-wordbook-btn" data-export-wordbook type="button">下载不背单词 TXT</button>
      </div>

      <div class="metrics-grid">
        ${metricCard("救命800有效词", stats.rescue, "始终纳入导出")}
        ${metricCard("已选生词", stats.unknown, "来自阅读 + 填空")}
        ${metricCard("待筛选", stats.unreviewed, `候选词共 ${stats.total}`)}
        ${metricCard("导出总数", stats.exportTotal, "已自动去重")}
      </div>

      <div class="toolbar wordbook-toolbar">
        <div class="toolbar-row">
          <span class="toolbar-label">状态</span>
          ${["unreviewed", "unknown", "known", "all"].map((mode) => `
            <button class="filter-btn ${state.wordbookMode === mode ? "active" : ""}" data-wordbook-mode="${mode}" type="button">
              ${escapeHtml({ unreviewed: `待筛选 ${stats.unreviewed}`, unknown: `生词 ${stats.unknown}`, known: `认识 ${stats.known}`, all: `全部 ${stats.total}` }[mode])}
            </button>
          `).join("")}
        </div>
        <div class="toolbar-row">
          <span class="toolbar-label">来源</span>
          ${["all", "fill", "reading"].map((source) => `
            <button class="filter-btn ${state.wordbookSource === source ? "active" : ""}" data-wordbook-source="${source}" type="button">
              ${escapeHtml({ all: "全部", fill: "填空", reading: "阅读" }[source])}
            </button>
          `).join("")}
          <label class="sr-only" for="wordbookSearch">搜索候选词</label>
          <input class="search-input" id="wordbookSearch" value="${escapeHtml(state.wordbookQuery)}" placeholder="搜索单词、释义或题句">
        </div>
        <div class="toolbar-row wordbook-bulk-row">
          <span class="toolbar-label">快速筛选</span>
          <button class="ghost-btn" data-wordbook-page-known type="button" ${pageItems.length ? "" : "disabled"}>本页全部标为认识</button>
          <span class="section-meta">本页 ${pageItems.length} 个，每个词的选择都会自动保存</span>
        </div>
      </div>

      <section class="section-band">
        <div class="section-head">
          <h2>题目词汇候选</h2>
          <span class="section-meta">${candidates.length ? `${pageStart + 1}-${Math.min(pageStart + pageSize, candidates.length)} / ${candidates.length}` : "0 个"}</span>
        </div>
        ${pageItems.length ? `
          <div class="candidate-grid">${pageItems.map(renderCandidateCard).join("")}</div>
          <div class="wordbook-pagination">
            <button class="ghost-btn" data-wordbook-page="${state.wordbookPage - 1}" type="button" ${state.wordbookPage === 0 ? "disabled" : ""}>上一页</button>
            <span>第 ${state.wordbookPage + 1} / ${pageCount} 页</span>
            <button class="ghost-btn" data-wordbook-page="${state.wordbookPage + 1}" type="button" ${state.wordbookPage >= pageCount - 1 ? "disabled" : ""}>下一页</button>
          </div>
        ` : '<div class="empty-state"><h2>当前筛选下没有词</h2><p>切换状态、来源或清空搜索条件继续。</p></div>'}
      </section>
    `;
  }

  function renderCandidateCard(candidate) {
    const status = wordbookStatus(candidate.word);
    const sourceLabel = candidate.sources.map((source) => ({ fill: "填空", reading: "阅读" }[source])).join(" + ");
    return `
      <article class="candidate-card ${status}" data-candidate-word="${escapeHtml(candidate.word)}">
        <div class="candidate-topline">
          <span>${escapeHtml(sourceLabel)}</span>
          <span>出现 ${candidate.count} 次</span>
        </div>
        <h3>${escapeHtml(candidate.word)}</h3>
        <p class="candidate-meaning">${candidate.meaning ? escapeHtml(candidate.meaning) : "题库词表暂无中文释义"}</p>
        <p class="candidate-context"><strong>英文释义：</strong>${escapeHtml(candidate.englishDefinition || "")}</p>
        <p class="candidate-context"><strong>例句：</strong>${escapeHtml(candidate.generatedExample || "")}</p>
        <div class="candidate-actions">
          <button class="quiet-btn wordbook-unknown ${status === "unknown" ? "active" : ""}" data-wordbook-status="unknown" data-word="${escapeHtml(candidate.word)}" aria-pressed="${status === "unknown"}" type="button">加入生词本</button>
          <button class="quiet-btn wordbook-known ${status === "known" ? "active" : ""}" data-wordbook-status="known" data-word="${escapeHtml(candidate.word)}" aria-pressed="${status === "known"}" type="button">认识</button>
        </div>
      </article>
    `;
  }

  function renderStudyCard(card, cards) {
    const options = optionsForCard(card);
    const currentStatus = statusOf(card.id);
    const synonyms = card.synonyms?.length ? card.synonyms.join(", ") : "";
    const commonMeaning = card.commonMeaning ? `
      <div class="detail-item">
        <div class="detail-label">常见义</div>
        <p class="detail-value">${escapeHtml(cleanChoiceMeaning(card.commonMeaning))}</p>
      </div>
    ` : "";

    return `
      <div class="study-layout">
        <article class="word-card">
          <div class="card-topline">
            <span>${state.currentIndex + 1} / ${cards.length}</span>
            <span>${escapeHtml(statusLabel(currentStatus))}${isCardInReview(card) ? " · 复习池" : ""}</span>
          </div>
          <h2 class="word-title">${escapeHtml(card.word)}</h2>
          <p class="word-occurrence">在填空＋阅读原题中出现 ${card.occurrenceCount || 0} 次</p>
          <div class="tag-row">${(card.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="choice-grid">
            ${options.map((option) => {
              let cls = "";
              if (state.revealed) {
                if (option === card.meaning) cls = "correct";
                else if (option === state.selectedOption) cls = "wrong";
                else cls = "dimmed";
              }
              return `<button class="choice-btn ${cls}" data-choice="${escapeHtml(option)}" type="button">${escapeHtml(cleanChoiceMeaning(option))}</button>`;
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
            ${isCardInReview(card) ? '<button class="quiet-btn remove-review" data-remove-review type="button">移除复习池</button>' : ""}
          </div>
        </article>

        <aside class="detail-panel">
          <h2>词条详情</h2>
          <div class="detail-item">
            <div class="detail-label">中文释义</div>
            <p class="detail-value">${state.revealed ? escapeHtml(card.studyMeaning || cleanChoiceMeaning(card.meaning)) : "选择释义后显示"}</p>
          </div>
          ${state.revealed ? `
            ${synonyms ? `<div class="detail-item">
              <div class="detail-label">等价词 / 近义词</div>
              <p class="detail-value">${escapeHtml(synonyms)}</p>
            </div>` : ""}
            ${commonMeaning}
            ${card.englishDefinition ? `<div class="detail-item">
              <div class="detail-label">英文释义（Collins COBUILD 风格）</div>
              <p class="detail-value">${escapeHtml(card.englishDefinition)}</p>
            </div>` : ""}
            <div class="detail-item">
              <div class="detail-label">助记</div>
              <p class="detail-value">${escapeHtml(cleanChoiceMeaning(card.mnemonic))}</p>
            </div>
            <div class="detail-item">
              <div class="detail-label">词义例句</div>
              <p class="detail-value">${escapeHtml(card.example)}</p>
            </div>
            <div class="detail-item">
              <div class="detail-label">例句来源</div>
              <p class="detail-value">${escapeHtml(card.exampleSource || card.source || "本地词库")}</p>
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
        ${correct ? "正确。" : `正确释义：${escapeHtml(cleanChoiceMeaning(card.meaning))}`}
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
              <span class="word-chip-count">${card.occurrenceCount || 0}次</span>
              <span class="status-dot ${status}"></span>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderPractice(type) {
    const allItems = filteredPracticeItems(type);
    const pageSize = type === "reading" ? 10 : 25;
    const pageCount = Math.max(1, Math.ceil(allItems.length / pageSize));
    state.practicePage[type] = Math.max(0, Math.min(state.practicePage[type] || 0, pageCount - 1));
    const page = state.practicePage[type];
    const items = allItems.slice(page * pageSize, (page + 1) * pageSize);
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
        <div class="toolbar-row section-nav-row">
          <button class="ghost-btn" data-practice-page="${page - 1}" data-practice-type="${type}" ${page === 0 ? "disabled" : ""} type="button">上一页</button>
          <span>第 ${page + 1}/${pageCount} 页</span>
          <button class="ghost-btn" data-practice-page="${page + 1}" data-practice-type="${type}" ${page >= pageCount - 1 ? "disabled" : ""} type="button">下一页</button>
        </div>
      </div>

      <section class="section-band">
        <div class="section-head">
          <h2>${labels[type]}</h2>
          <span class="section-meta">共 ${allItems.length} 组；当前显示 ${items.length} 组；题干与选项来自用户提供的原始 PDF</span>
        </div>
        ${items.length ? `<div class="question-list">${items.map((item, index) => renderQuestion(type, item, index)).join("")}</div>` : (type === "math" ? '<div class="empty-state"><h2>当前没有符合筛选条件的数学题</h2><p>切换筛选条件后继续练习。</p></div>' : '<div class="empty-state"><h2>当前队列为空</h2><p>切换筛选条件继续练习。</p></div>')}
      </section>
    `;
  }

  function renderQuestion(type, item, index) {
    if (type === "reading") {
      const passageLookupQuestionId = item.questions
        .map((question, qIndex) => `${item.id}-q${qIndex + 1}`)
        .find((questionId) => practiceSubmittedRecord(practiceRecord(questionId)));
      const passageRevealed = Boolean(passageLookupQuestionId);
      return `
        <article class="question-card">
          <div class="question-title"><span>Passage ${index + 1}</span><span>${(item.tags || []).map(escapeHtml).join(" / ")}</span></div>
          <div class="reading-passage">${renderLookupStem(item.passage, passageLookupQuestionId || item.id, passageRevealed, "reading", "passage")}</div>
          ${renderPassageAnalysis(item.id, passageRevealed)}
          ${item.questions.map((question, qIndex) => renderOptionQuestion(`${item.id}-q${qIndex + 1}`, question, qIndex, item.tags || [])).join("")}
        </article>
      `;
    }

    if (type === "math" && item.type === "select-all") {
      const record = practiceRecord(item.id);
      const revealed = Boolean(record);
      const lookupEnabled = practiceSubmittedRecord(record);
      const draft = state.practiceDrafts[item.id] || [];
      return `
        <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
          ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
          <p class="stem">${renderLookupStem(item.stem, item.id, lookupEnabled, "math")}</p>
          <p class="question-instruction">Indicate all such choices.</p>
          <ul class="option-list">
            ${item.options.map((option, optionIndex) => `
              <li><button class="${practiceOptionClass(item.id, optionIndex, item.answer, revealed, draft)}" data-toggle-question="${escapeHtml(item.id)}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button></li>
            `).join("")}
          </ul>
          <div class="question-actions">
            <button class="primary-btn" data-submit-toggle="${escapeHtml(item.id)}" type="button">提交</button>
            <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
          </div>
          <div class="explanation">${renderResultLine(record)}<div class="answer-key">答案：${answerLetters(item.answer)}。</div>${renderPracticeAnalysis(type, item)}</div>
        </article>
      `;
    }

    if (item.type === "two-blank" || item.type === "three-blank") {
      const record = practiceRecord(item.id);
      const revealed = Boolean(record);
      const lookupEnabled = practiceSubmittedRecord(record);
      const draft = state.practiceDrafts[item.id] || [];
      return `
        <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
          ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
          <p class="stem">${renderLookupStem(item.stem, item.id, lookupEnabled, type === "math" ? "math" : "fill")}</p>
          ${item.blanks.map((blank, blankIndex) => `
            <div class="blank-label">Blank ${blankIndex + 1}</div>
            <ul class="option-list">
              ${blank.map((option, optionIndex) => `
                <li>
                  <button class="${practiceOptionClass(item.id, optionIndex, item.answer[blankIndex], revealed, draft, blankIndex)}" data-blank-question="${escapeHtml(item.id)}" data-blank-index="${blankIndex}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button>
                  ${type === "fill" ? renderOptionStudy(option, lookupEnabled, item) : ""}
                </li>
              `).join("")}
            </ul>
          `).join("")}
          <div class="question-actions">
            <button class="primary-btn" data-submit-blank="${escapeHtml(item.id)}" type="button">提交</button>
            <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
          </div>
          <div class="explanation">${renderResultLine(record)}<div class="answer-key">答案：${item.answer.map((ans, i) => `Blank ${i + 1} ${String.fromCharCode(65 + ans)}`).join("；")}。</div>${renderPracticeAnalysis(type, item)}</div>
        </article>
      `;
    }

    if (item.type === "sentence-equivalence") {
      const record = practiceRecord(item.id);
      const revealed = Boolean(record);
      const lookupEnabled = practiceSubmittedRecord(record);
      const draft = state.practiceDrafts[item.id] || [];
      return `
        <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
          ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
          <p class="stem">${renderLookupStem(item.stem, item.id, lookupEnabled, type === "math" ? "math" : "fill")}</p>
          <ul class="option-list">
            ${item.options.map((option, optionIndex) => `
              <li>
                <button class="${practiceOptionClass(item.id, optionIndex, item.answer, revealed, draft)}" data-toggle-question="${escapeHtml(item.id)}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button>
                ${type === "fill" ? renderOptionStudy(option, lookupEnabled, item) : ""}
              </li>
            `).join("")}
          </ul>
          <div class="question-actions">
            <button class="primary-btn" data-submit-toggle="${escapeHtml(item.id)}" type="button">提交</button>
            <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
          </div>
          <div class="explanation">${renderResultLine(record)}<div class="answer-key">答案：${item.answer.map((ans) => String.fromCharCode(65 + ans)).join(", ")}。</div>${renderPracticeAnalysis(type, item)}</div>
        </article>
      `;
    }

    const record = practiceRecord(item.id);
    const revealed = Boolean(record);
    const lookupEnabled = practiceSubmittedRecord(record);
    return `
      <article class="question-card ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(item.id)}">
        ${renderQuestionTopline(`Question ${index + 1}`, item.tags || [], item.id)}
        <p class="stem">${renderLookupStem(item.stem, item.id, lookupEnabled, type === "math" ? "math" : "fill")}</p>
        <ul class="option-list">
          ${item.options.map((option, optionIndex) => `
            <li>
              <button class="${practiceOptionClass(item.id, optionIndex, item.answer, revealed)}" data-practice="${escapeHtml(item.id)}" data-option-index="${optionIndex}" type="button">${String.fromCharCode(65 + optionIndex)}. ${escapeHtml(option)}</button>
              ${type === "fill" ? renderOptionStudy(option, lookupEnabled, item) : ""}
            </li>
          `).join("")}
        </ul>
        <div class="question-actions">
          <button class="ghost-btn" data-show-answer="${escapeHtml(item.id)}" type="button">查看解析</button>
        </div>
        <div class="explanation">${renderResultLine(record)}<div class="answer-key">答案：${answerLetters(item.answer)}。</div>${renderPracticeAnalysis(type, item)}</div>
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

  function renderReadingOption(id, question, option, optionIndex, revealed, lookupEnabled, draft = []) {
    const classes = practiceOptionClass(id, optionIndex, question.answer, revealed, draft);
    const label = String.fromCharCode(65 + optionIndex);
    if (lookupEnabled) {
      return `<div class="${classes} reading-option-result">${label}. ${renderLookupStem(option, id, true, "reading", `option-${optionIndex}`)}</div>`;
    }
    if (question.type === "select-all") {
      return `<button class="${classes}" data-toggle-question="${escapeHtml(id)}" data-option-index="${optionIndex}" type="button">${label}. ${escapeHtml(option)}</button>`;
    }
    return `<button class="${classes}" data-reading="${escapeHtml(id)}" data-answer="${question.answer}" data-option-index="${optionIndex}" type="button">${label}. ${escapeHtml(option)}</button>`;
  }

  function renderOptionQuestion(id, question, qIndex, tags) {
    const record = practiceRecord(id);
    const revealed = Boolean(record);
    const lookupEnabled = practiceSubmittedRecord(record);
    const draft = state.practiceDrafts[id] || [];
    if (!question.options.length) {
      return `
        <div class="reading-question" data-question-id="${escapeHtml(id)}">
          ${renderQuestionTopline(`${qIndex + 1}. Reading Question`, tags, id)}
          <p class="stem">${qIndex + 1}. ${renderLookupStem(question.q, id, lookupEnabled, "reading")}</p>
          <details class="source-answer"><summary>查看解析</summary><div class="answer-key">答案 PDF 标注：${escapeHtml(question.answerText || "请对照阅读440答案.pdf。")}</div>${renderGeneratedAnalysis(id, question.explanation, "reading")}</details>
        </div>
      `;
    }
    if (question.type === "select-all") {
      return `
        <div class="reading-question ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(id)}">
          ${renderQuestionTopline(`${qIndex + 1}. Reading Question`, tags, id)}
          <p class="stem">${qIndex + 1}. ${renderLookupStem(question.q, id, lookupEnabled, "reading")}</p>
          <ul class="option-list">
            ${question.options.map((option, optionIndex) => `
              <li>${renderReadingOption(id, question, option, optionIndex, revealed, lookupEnabled, draft)}</li>
            `).join("")}
          </ul>
          <div class="question-actions">
            <button class="primary-btn" data-submit-toggle="${escapeHtml(id)}" type="button">提交</button>
            <button class="ghost-btn" data-show-answer="${escapeHtml(id)}" type="button">查看答案</button>
          </div>
          <div class="explanation">${renderResultLine(record)}<div class="answer-key">答案：${answerLetters(question.answer)}。</div>${renderGeneratedAnalysis(id, question.explanation, "reading")}</div>
        </div>
      `;
    }
    return `
      <div class="reading-question ${revealed ? "revealed" : ""}" data-question-id="${escapeHtml(id)}">
        ${renderQuestionTopline(`${qIndex + 1}. Reading Question`, tags, id)}
        <p class="stem">${qIndex + 1}. ${renderLookupStem(question.q, id, lookupEnabled, "reading")}</p>
        <ul class="option-list">
          ${question.options.map((option, optionIndex) => `
            <li>${renderReadingOption(id, question, option, optionIndex, revealed, lookupEnabled)}</li>
          `).join("")}
        </ul>
        <div class="question-actions">
          <button class="ghost-btn" data-show-answer="${escapeHtml(id)}" type="button">查看解析</button>
        </div>
        <div class="explanation">${renderResultLine(record)}<div class="answer-key">答案：${answerLetters(question.answer)}。</div>${renderGeneratedAnalysis(id, question.explanation, "reading")}</div>
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

  let cachedVerbalSections = null;

  function buildVerbalSections() {
    if (cachedVerbalSections) return cachedVerbalSections;
    const levels = ["easy", "medium", "hard"];
    const fillPools = Object.fromEntries(levels.map((level) => [
      level,
      (data.practice.fill || []).filter((item) => item.difficulty === level),
    ]));
    const readingPools = Object.fromEntries(levels.map((level) => [
      level,
      (data.practice.reading || []).filter((passage) => passage.difficulty === level).flatMap((passage) =>
        passage.questions.map((question, qIndex) => ({
          kind: "reading",
          id: `${passage.id}-q${qIndex + 1}`,
          passage,
          question,
          qIndex,
          difficulty: level,
        }))
      ),
    ]));
    const cursors = {
      fill: { easy: 0, medium: 0, hard: 0 },
      reading: { easy: 0, medium: 0, hard: 0 },
    };

    function take(kind, level) {
      const pools = kind === "fill" ? fillPools : readingPools;
      const pool = pools[level].length ? pools[level] : levels.flatMap((fallback) => pools[fallback]);
      if (!pool.length) return null;
      const index = cursors[kind][level]++ % pool.length;
      return kind === "fill" ? { kind: "fill", item: pool[index], difficulty: level } : pool[index];
    }

    const sections = [];
    for (let sectionIndex = 0; sectionIndex < 60; sectionIndex += 1) {
      const size = sectionIndex % 2 === 0 ? 12 : 15;
      const fillPattern = size === 12
        ? ["easy", "medium", "hard", "medium", "easy", "hard", "medium"]
        : ["easy", "medium", "hard", "medium", "easy", "hard", "medium", "medium"];
      const readingPattern = size === 12
        ? ["easy", "medium", "hard", "medium", "hard"]
        : ["easy", "medium", "hard", "medium", "easy", "hard", "medium"];
      const fills = fillPattern.map((level) => take("fill", level)).filter(Boolean);
      const readings = readingPattern.map((level) => take("reading", level)).filter(Boolean);
      const items = [];
      while (fills.length || readings.length) {
        if (fills.length) items.push(fills.shift());
        if (fills.length) items.push(fills.shift());
        if (readings.length) items.push(readings.shift());
      }
      sections.push({ id: `verbal-section-${sectionIndex + 1}`, size, items });
    }
    cachedVerbalSections = sections;
    return sections;
  }

  function renderSectionItem(ref, index) {
    if (ref.kind === "fill") return renderQuestion("fill", ref.item, index);
    const passageRevealed = practiceSubmittedRecord(practiceRecord(ref.id));
    return `
      <article class="question-card">
        <div class="question-title"><span>Question ${index + 1} · Reading</span><span>Passage ${ref.passage.originalPassage} / ${escapeHtml(ref.difficulty)}</span></div>
        <div class="reading-passage">${renderLookupStem(ref.passage.passage, ref.id, passageRevealed, "reading", "passage")}</div>
        ${renderPassageAnalysis(ref.passage.id, passageRevealed)}
        ${renderOptionQuestion(ref.id, ref.question, index, ref.passage.tags || [])}
      </article>
    `;
  }

  function renderSection() {
    const sections = buildVerbalSections();
    state.sectionIndex = Math.max(0, Math.min(state.sectionIndex, sections.length - 1));
    const section = sections[state.sectionIndex];
    const fillCount = section.items.filter((item) => item.kind === "fill").length;
    const readingCount = section.items.length - fillCount;
    document.getElementById("view-section").innerHTML = `
      <div class="metrics-grid">
        ${metricCard("Section", `${state.sectionIndex + 1}/${sections.length}`, `${section.size} 题`)}
        ${metricCard("填空", fillCount, "Text Completion / SE")}
        ${metricCard("阅读", readingCount, "Reading Comprehension")}
        ${metricCard("难度", "混合", "Easy / Medium / Hard")}
      </div>
      <div class="toolbar">
        <div class="toolbar-row section-nav-row">
          <button class="ghost-btn" data-section-step="-1" ${state.sectionIndex === 0 ? "disabled" : ""} type="button">上一组</button>
          <strong>Section ${state.sectionIndex + 1}</strong>
          <span>${section.size} 题；${fillCount} 填空 + ${readingCount} 阅读</span>
          <button class="primary-btn" data-section-step="1" ${state.sectionIndex === sections.length - 1 ? "disabled" : ""} type="button">下一组</button>
        </div>
      </div>
      <section class="section-band">
        <div class="section-head"><h2>GRE Verbal Section</h2><span class="section-meta">题目均来自填空2000题与阅读440篇原始 PDF</span></div>
        <div class="question-list">${section.items.map(renderSectionItem).join("")}</div>
      </section>
    `;
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
    if (state.view === "wordbook") renderWordbook();
    if (state.view === "fill") renderPractice("fill");
    if (state.view === "math") renderPractice("math");
    if (state.view === "reading") renderPractice("reading");
    if (state.view === "section") renderSection();
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

    const sectionStep = event.target.closest("[data-section-step]");
    if (sectionStep && !sectionStep.disabled) {
      state.sectionIndex += Number(sectionStep.dataset.sectionStep);
      window.scrollTo({ top: 0, behavior: "smooth" });
      render();
      return;
    }

    const dashboardAction = event.target.closest("[data-dashboard-action]");
    if (dashboardAction) {
      if (dashboardAction.dataset.dashboardAction === "review") {
        state.deckId = personalWordbookCards().some((card) => isCardInReview(card)) ? "personal" : "equiv";
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
      } else if (dashboardAction.dataset.dashboardAction === "wordbook") {
        setView("wordbook");
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
      state.practicePage[practiceModeBtn.dataset.practiceType] = 0;
      render();
      return;
    }

    const practicePageBtn = event.target.closest("[data-practice-page]");
    if (practicePageBtn && !practicePageBtn.disabled) {
      const type = practicePageBtn.dataset.practiceType;
      state.practicePage[type] = Number(practicePageBtn.dataset.practicePage);
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const wordbookModeBtn = event.target.closest("[data-wordbook-mode]");
    if (wordbookModeBtn) {
      state.wordbookMode = wordbookModeBtn.dataset.wordbookMode;
      state.wordbookPage = 0;
      render();
      return;
    }

    const wordbookSourceBtn = event.target.closest("[data-wordbook-source]");
    if (wordbookSourceBtn) {
      state.wordbookSource = wordbookSourceBtn.dataset.wordbookSource;
      state.wordbookPage = 0;
      render();
      return;
    }

    const wordbookStatusBtn = event.target.closest("[data-wordbook-status]");
    if (wordbookStatusBtn) {
      setWordbookStatus(wordbookStatusBtn.dataset.word, wordbookStatusBtn.dataset.wordbookStatus);
      return;
    }

    const stemLookupBtn = event.target.closest("[data-stem-lookup]");
    if (stemLookupBtn) {
      const id = stemLookupBtn.dataset.stemItem;
      const word = normalizeWord(stemLookupBtn.dataset.stemLookup);
      const position = stemLookupBtn.dataset.stemPosition;
      if (!practiceSubmittedRecord(practiceRecord(id))) return;
      const isOpen = state.openStemLookup?.id === id
        && state.openStemLookup?.word === word
        && state.openStemLookup?.position === position;
      state.openStemLookup = isOpen ? null : {
        id,
        word,
        position,
        kind: stemLookupBtn.dataset.stemKind || "fill",
      };
      render();
      return;
    }

    const stemAddBtn = event.target.closest("[data-stem-add]");
    if (stemAddBtn && !stemAddBtn.disabled) {
      if (!practiceSubmittedRecord(practiceRecord(stemAddBtn.dataset.stemItem))) return;
      toggleStemWordbook(
        stemAddBtn.dataset.stemAdd,
        stemAddBtn.dataset.stemItem,
        stemAddBtn.dataset.stemKind || "fill"
      );
      return;
    }

    const stemKnownBtn = event.target.closest("[data-stem-known]");
    if (stemKnownBtn) {
      markStemKnown(stemKnownBtn.dataset.stemKnown);
      return;
    }

    const optionWordbookBtn = event.target.closest("[data-option-wordbook]");
    if (optionWordbookBtn && !optionWordbookBtn.disabled) {
      toggleOptionWordbook(
        optionWordbookBtn.dataset.optionWordbook,
        optionWordbookBtn.dataset.optionItem,
        optionWordbookBtn.dataset.optionKey
      );
      return;
    }

    const wordbookPageBtn = event.target.closest("[data-wordbook-page]");
    if (wordbookPageBtn && !wordbookPageBtn.disabled) {
      state.wordbookPage = Number(wordbookPageBtn.dataset.wordbookPage);
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const wordbookPageKnown = event.target.closest("[data-wordbook-page-known]");
    if (wordbookPageKnown && !wordbookPageKnown.disabled) {
      document.querySelectorAll("[data-candidate-word]").forEach((card) => {
        const word = card.dataset.candidateWord;
        progress.wordbook[word] = { status: "known", updatedAt: new Date().toISOString() };
        setPersonalReviewMembership(word, false);
      });
      saveProgress();
      render();
      return;
    }

    const wordbookExport = event.target.closest("[data-export-wordbook]");
    if (wordbookExport) {
      exportWordbook();
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

    const removeReview = event.target.closest("[data-remove-review]");
    if (removeReview) {
      const card = currentCard();
      if (card) {
        removeCardFromReview(card);
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
      state.openStemLookup = null;
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
      const question = findPracticeQuestion(toggleOption.dataset.toggleQuestion);
      toggleDraftOption(
        toggleOption.dataset.toggleQuestion,
        Number(toggleOption.dataset.optionIndex),
        question?.type === "select-all" ? (question.options?.length || 3) : 2
      );
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

    if (event.target.id === "importBtn") {
      document.getElementById("importProgressInput").click();
      return;
    }

    if (event.target.id === "resetBtn") {
      if (confirm("确认重置本地学习进度？")) {
        progress = emptyProgress();
        saveProgress();
        resetCardSession();
        render();
      }
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.id !== "importProgressInput") return;
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("进度文件超过 5 MB，请检查文件是否正确。");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const imported = normalizeProgress(isRecord(parsed) && "progress" in parsed ? parsed.progress : parsed);
      if (!imported) throw new Error("invalid progress format");
      const hasProgress = [progress.cards, progress.practice, progress.wordbook]
        .some((entries) => Object.keys(entries).length > 0);
      if (hasProgress && !confirm("导入会替换当前浏览器的学习进度。继续前会自动下载一份当前进度备份。")) return;
      if (hasProgress) exportProgress(`gre-progress-before-import-${Date.now()}.json`);
      progress = imported;
      saveProgress();
      resetCardSession();
      render();
      alert("进度导入成功。");
    } catch (error) {
      alert("无法导入进度：请选择备考台导出的 gre-progress.json 文件。");
    }
  });

  document.addEventListener("input", (event) => {
    if (!["wordSearch", "wordbookSearch"].includes(event.target.id)) return;
    const cursor = event.target.selectionStart;
    const isWordbookSearch = event.target.id === "wordbookSearch";
    if (isWordbookSearch) {
      state.wordbookQuery = event.target.value;
      state.wordbookPage = 0;
    } else {
      state.query = event.target.value;
      resetCardSession();
    }
    render();
    const inputId = isWordbookSearch ? "wordbookSearch" : "wordSearch";
    const input = document.getElementById(inputId);
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
    const isSelectAll = question.type === "select-all";
    const complete = isSelectAll
      ? draft.length > 0
      : draft.length >= expected && draft.slice(0, expected).every((value) => Number.isInteger(value));

    if (!complete) {
      alert("请先选完整答案。");
      return;
    }

    const isMultiBlank = question.type === "two-blank" || question.type === "three-blank";
    savePracticeAnswer(id, isSelectAll ? draft : draft.slice(0, expected), question.answer, isMultiBlank);
    delete state.practiceDrafts[id];
    render();
  }

  function showPracticeAnswer(id) {
    const question = findPracticeQuestion(id);
    if (!question) return;
    if (!practiceRecord(id)) {
      savePracticeAnswer(id, [], question.answer, false, false);
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

  function exportProgress(filename = "gre-progress.json") {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), progress }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    downloadBlob(blob, filename);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setWordbookStatus(word, status) {
    const normalized = normalizeWord(word);
    if (!normalized) return;
    if (progress.wordbook[normalized]?.status === status) {
      delete progress.wordbook[normalized];
      setPersonalReviewMembership(normalized, false);
    } else {
      progress.wordbook[normalized] = {
        ...(progress.wordbook[normalized] || {}),
        status,
        updatedAt: new Date().toISOString(),
      };
      setPersonalReviewMembership(normalized, status === "unknown");
    }
    cachedQuestionVocabulary = null;
    saveProgress();
    render();
  }

  function toggleOptionWordbook(word, itemId, optionKey) {
    const normalized = normalizeWord(word);
    if (!normalized) return;
    if (progress.wordbook[normalized]?.status === "unknown") {
      delete progress.wordbook[normalized];
      setPersonalReviewMembership(normalized, false);
    } else {
      const question = findPracticeQuestion(itemId);
      progress.wordbook[normalized] = {
        ...(progress.wordbook[normalized] || {}),
        status: "unknown",
        meaning: optionMeanings[optionKey] || optionMeanings[normalized] || "",
        manual: true,
        source: "fill",
        context: question?.stem || "",
        itemId,
        updatedAt: new Date().toISOString(),
      };
      setPersonalReviewMembership(normalized, true);
    }
    cachedQuestionVocabulary = null;
    saveProgress();
    render();
  }

  function findStemVocabularyEntry(itemId, kind, word) {
    const normalized = normalizeWord(word);
    return (generatedExplanations[kind]?.[itemId]?.vocabulary || [])
      .find((entry) => normalizeWord(entry.term) === normalized) || null;
  }

  function toggleStemWordbook(word, itemId, kind) {
    const normalized = normalizeWord(word);
    if (!normalized) return;
    if (progress.wordbook[normalized]?.status === "unknown") {
      delete progress.wordbook[normalized];
      setPersonalReviewMembership(normalized, false);
    } else {
      const entry = findStemVocabularyEntry(itemId, kind, normalized);
      const question = findPracticeQuestion(itemId);
      progress.wordbook[normalized] = {
        ...(progress.wordbook[normalized] || {}),
        status: "unknown",
        meaning: entry?.meaning || "",
        manual: true,
        source: kind === "reading" ? "reading" : "fill",
        context: question?.stem || question?.q || "",
        itemId,
        updatedAt: new Date().toISOString(),
      };
      setPersonalReviewMembership(normalized, true);
    }
    cachedQuestionVocabulary = null;
    saveProgress();
    render();
  }

  function markStemKnown(word) {
    const normalized = normalizeWord(word);
    if (!normalized) return;
    progress.wordbook[normalized] = {
      ...(progress.wordbook[normalized] || {}),
      status: "known",
      updatedAt: new Date().toISOString(),
    };
    setPersonalReviewMembership(normalized, false);
    state.openStemLookup = null;
    cachedQuestionVocabulary = null;
    saveProgress();
    render();
  }

  function setPersonalReviewMembership(word, included) {
    const id = personalCardId(word);
    const current = progress.cards[id] || {
      attempts: 0,
      correct: 0,
      status: included ? "fuzzy" : "new",
      history: [],
    };
    current.inReviewPool = included;
    if (included && current.status === "new") current.status = "fuzzy";
    current.updatedAt = new Date().toISOString();
    progress.cards[id] = current;
  }

  function exportWordbook() {
    const output = [];
    const seen = new Set();
    const addWord = (value) => {
      const word = normalizeWord(value).replace(/\s+/g, " ").trim();
      if (!word || seen.has(word)) return;
      seen.add(word);
      output.push(word);
    };
    const frequency = questionWordFrequency();
    [...rescueDeck().cards]
      .sort((left, right) => (frequency.get(normalizeWord(right.word)) || 0) - (frequency.get(normalizeWord(left.word)) || 0))
      .forEach((card) => addWord(card.word));
    questionVocabulary()
      .filter((candidate) => wordbookStatus(candidate.word) === "unknown")
      .map((candidate) => candidate.word)
      .forEach(addWord);

    const blob = new Blob([output.join("\n")], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, "gre_rescue800_personal.txt");
  }

  function reconcileSavedPracticeResults() {
    let changed = false;
    Object.entries(progress.practice).forEach(([id, record]) => {
      if (!record || !(record.attempts > 0) || !["correct", "wrong"].includes(record.status)) return;
      const question = findPracticeQuestion(id);
      if (!question) return;
      const ordered = question.type === "two-blank" || question.type === "three-blank";
      const correct = ordered
        ? sameOrderedAnswer(record.selected, question.answer)
        : sameAnswer(record.selected, question.answer);
      const recalculatedStatus = correct ? "correct" : "wrong";
      if (record.status === recalculatedStatus) return;
      if (record.status === "correct" && !correct) {
        record.correct = Math.max(0, Number(record.correct || 0) - 1);
      } else if (record.status === "wrong" && correct) {
        record.correct = Number(record.correct || 0) + 1;
      }
      record.status = recalculatedStatus;
      record.updatedAt = new Date().toISOString();
      changed = true;
    });
    if (changed) saveProgress();
  }

  reconcileSavedPracticeResults();
  render();
}());
