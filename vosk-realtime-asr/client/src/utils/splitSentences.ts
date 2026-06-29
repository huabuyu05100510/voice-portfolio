/**
 * splitSentences — 长句分行工具
 *
 * 火山引擎一个 utterance 可能是长达几十秒的连贯独白, 单行显示阅读体验差.
 * 本工具按中文/英文句末标点 (。！？.!?…) 切分文本, 保留标点, 返回多行数组.
 *
 * 卡片身份 (start_time / speaker / TranscriptionResult) 不变 — 仅显示层分行.
 *
 * Author: glm-5.2
 */

/**
 * 按句末标点切分文本, 保留标点在句尾.
 *
 * 规则:
 * - 切分符: 。！？… . ! ? (全角/半角句号/感叹号/问号/省略号)
 * - 标点保留在前一句末尾
 * - 过滤空串 (连续标点不再产生空句)
 * - 无切分符的短文本 → 返回单元素数组 [text]
 *
 * 示例:
 *   splitSentences("你好。我是王楚然！")  → ["你好。", "我是王楚然！"]
 *   splitSentences("短句")                → ["短句"]
 *   splitSentences("一。二。三。")         → ["一。", "二。", "三。"]
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  // 匹配: 非-句末标点 字符序列 + 一个/多个句末标点
  // 中文省略号 … 作为单字符处理; ASCII ... 三个点作为一个整体 (贪婪匹配)
  // 句末标点: 。！？… . ! ? (全角+半角+省略号)
  // 注意: ASCII . ! ? 也必须排除出"非切分字符"类, 否则半角场景切不开
  const DELIM = '。！？!?….';
  const re = new RegExp(
    `([^${DELIM}]+[${DELIM}]+|\\.{3,}|[^${DELIM}]+$)`,
    'g',
  );
  const matches = text.match(re);
  if (!matches) return [text];
  // 去掉首尾空白后再过滤空串
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}
