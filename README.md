# FB Group 帖子采集器 — Chrome 扩展

## 功能介绍

在 Facebook Group 页面一键抓取帖子，调用 Claude AI 自动解析结构化字段，支持导出 JSON / CSV / TXT。

**提取字段：** 作者、时间、正文、帖子类型（出售/求购/分享/公告）、价格、地点、点赞/评论/分享数、关键词、AI 摘要、帖子链接

---

## 安装方法（Chrome / Edge）

1. 下载并解压 `fb-scraper-extension` 文件夹到本地
2. 打开浏览器，地址栏输入：`chrome://extensions`
3. 右上角开启 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择 `fb-scraper-extension` 文件夹
5. 扩展图标出现在工具栏 ✓

---

## 使用步骤

### 第一次使用
1. 点击扩展图标，在 **API Key** 输入框填入你的 [Anthropic API Key](https://console.anthropic.com/)
2. 点击「保存」

### 采集帖子
1. 浏览器打开任意 `facebook.com/groups/…` 页面
2. 点击扩展图标
3. 设置「最多抓取」条数和「自动滚动」次数（滚动可加载更多帖子）
4. 点击 **采集帖子** — 扩展会自动滚动页面并提取帖子内容
5. 点击 **AI 解析** — 调用 Claude 补充分类、价格、地点、摘要等字段
6. 在列表中点击任意帖子可跳转原帖

### 导出数据
采集/解析完成后，底部会出现导出按钮：
- **JSON** — 完整结构化数据，适合开发者/进一步处理
- **CSV** — 可用 Excel / Numbers / Google Sheets 打开
- **TXT** — 纯文本，阅读友好

---

## 文件结构

```
fb-scraper-extension/
├── manifest.json      # 扩展配置
├── content.js         # 注入 Facebook 页面，负责 DOM 抓取
├── popup.html         # 弹窗 UI
├── popup.js           # 弹窗逻辑，AI 解析，导出
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 注意事项

- **本扩展仅供个人学习研究使用**，请勿大规模采集或商业用途，遵守 Facebook 服务条款
- AI 解析需要 Anthropic API Key（按 token 计费，成本很低）
- Facebook 页面结构频繁更新，若采集结果为空，可尝试刷新页面后重试
- 采集结果缓存在本地浏览器存储中，关闭弹窗不会丢失

---

## 常见问题

**Q: 点击采集帖子但没有结果？**  
A: 确认当前页面是 `facebook.com/groups/` 开头，且页面已加载完成。可尝试增加「自动滚动」次数让更多内容加载。

**Q: AI 解析报错 "API 错误 401"？**  
A: API Key 填写有误，请检查并重新保存。

**Q: 采集到的帖子缺少作者或时间？**  
A: Facebook 页面结构因账号、语言、A/B 测试会有差异，部分字段可能解析不到，正文内容一般都能正常提取。
