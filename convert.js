// Переклад між форматом Anthropic (його використовує інтерфейс) і OpenAI-сумісним (ChatGPT, Kimi, Gemini)
function toOpenAI(system, messages, tools) {
  const out = [{ role: 'system', content: system || '' }];
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = m.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) });
        else if (b.type === 'text') out.push({ role: 'user', content: b.text });
      }
    }
  }
  const t = (tools || []).map(x => ({ type: 'function', function: { name: x.name, description: x.description, parameters: x.input_schema } }));
  return { messages: out, tools: t };
}
function fromOpenAI(data) {
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) throw new Error('Порожня відповідь від сервісу');
  const content = [];
  if (msg.content) content.push({ type: 'text', text: String(msg.content) });
  for (const c of msg.tool_calls || []) {
    let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch {}
    content.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
  }
  return { content, stop_reason: (msg.tool_calls || []).length ? 'tool_use' : 'end_turn' };
}
module.exports = { toOpenAI, fromOpenAI };
