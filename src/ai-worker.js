import { analyze } from './ai.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ revision: data.revision, ...analyze(data.board, data.turn, data.level) }); }
  catch { self.postMessage({ revision: data.revision, error: 'AI 分析暂时不可用，请重试' }); }
};
