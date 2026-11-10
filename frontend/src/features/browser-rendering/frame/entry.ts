/**
 * The renderer route's DOM shell. The main site's single index.html hosts both the
 * application and this isolated internal frame; the route is selected before the
 * main entry is imported (see src/main.tsx). This module owns only the frame's
 * stage/shield/overlay/badge/audio elements and their CSS.
 */

import './renderer-frame.css';

const FRAME_MARKUP = `
  <div id="stage"></div>
  <div id="shield" hidden></div>
  <div id="overlay" role="alert" aria-live="assertive" hidden></div>
  <button id="audio" type="button" hidden>启用旁白</button>
  <div id="badge"></div>
`;

export async function mountRendererFrame(root: HTMLElement): Promise<void> {
  document.title = 'ManimCat 浏览器渲染器';
  document.documentElement.lang = 'zh-CN';
  document.documentElement.style.colorScheme = 'dark';
  root.innerHTML = FRAME_MARKUP;
  // The legacy standalone HTML entry is gone. Import the runtime only after the frame
  // DOM exists, and never import the main application or its providers on this route.
  await import('./main');
}
