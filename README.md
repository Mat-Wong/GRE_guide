# GRE 备考台

一个本地优先的 GRE 备考网页。项目是纯静态站点，可以直接打开 `index.html` 使用，也可以把 `docs/` 目录发布到 GitHub Pages。

## 功能

- 背词：中文释义四选一、模糊/认识/错误状态、答后显示正确含义、助记、例句和 GRE 近义词。
- 填空：单空、双空、六选二练习，支持提交、查看解析、错题和收藏。
- 数学：覆盖 Quantitative Comparison、平均数、几何、速率等常见考点，解析附英文术语释义。
- 阅读：短 passage 加题目，支持解析、错题、收藏，解析附 passage 和题目重点词释义。
- 进度：全部保存在浏览器本地，不需要账号、服务器或数据库。

## 数据规模

- 词卡：6526 条。
- 填空：759 题。
- 数学：377 题。
- 阅读：86 篇 passage，172 道小题。

## 本地运行

直接双击打开：

```text
index.html
```

或启动本地静态服务器：

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

然后访问：

```text
http://127.0.0.1:8765/
```

## GitHub Pages

生成发布目录：

```powershell
node scripts/build-site.js
```

推荐在 GitHub Pages 中选择 `docs/` 目录作为发布源。公开发布只需要：

```text
docs/index.html
docs/assets/
docs/data/gre-data.js
docs/README.md
docs/.nojekyll
```

不要上传原始 PDF、DOCX、本地缓存、脚本临时输出或中间提取数据。

## 版权处理说明

公开站点不包含原始 PDF、DOCX 或课程讲义文件。练习题和解析以原创/改写内容为主，词卡例句和助记为重新整理生成内容，并移除了公开数据中的原始文件名和页码类来源标记。

这不是法律意见；如果要公开传播或商业化，仍建议再做人工抽样复核和必要的法律确认。
