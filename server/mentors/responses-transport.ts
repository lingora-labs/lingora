// =============================================================================
// server/mentors/responses-transport.ts — 7.7-SOL
// Transport of the Tutor to the OpenAI Responses API (required by gpt-6.1-sol for tool calling).
//
// ONE boundary, no second author: the Tutor engine keeps its single reading of the provider stream (chat-chunk shape:
// {model, choices:[{delta:{content, tool_calls:[{index,id,function:{name,arguments}}]}}], usage}). This module speaks
// Responses to the provider and hands the engine exactly that shape, so identity gating, tool contracts, memory, artifacts
// and delivery failures are the SAME code path for every product model. Nothing here decides what the Tutor says.
//
// Facts from the provider docs (developers.openai.com, 5 Nov 2026) this code relies on:
//  - gpt-6.1-sol supports reasoning.effort low|medium|high|xhigh|max; `none` and `minimal` are NOT supported.
//  - temperature / top_p / logprobs are not accepted for models that cannot run at `none`.
//  - Tool calling requires the Responses API; function tools put name/parameters at the top level; strict defaults to true,
//    so it is set to false explicitly to keep the Tutor's existing schemas valid.
// =============================================================================

/** Models whose Tutor transport is the Responses API. */
export function usesResponsesApi(model: string): boolean {
  return /^gpt-6/i.test(model)
}

export type TutorEffort = 'low' | 'medium'
/** `low` is the documented floor for gpt-6.1-sol and the latency-sensitive setting; `medium` is the documented default.
 *  Read per call from TUTOR_REASONING_EFFORT so that a preview can compare both without a code change. Anything else → low. */
export function tutorEffort(raw: string | undefined = process.env.TUTOR_REASONING_EFFORT): TutorEffort {
  return raw === 'medium' ? 'medium' : 'low'
}

type ChatMessage = { role: string; content?: unknown; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; tool_call_id?: string }
type ChatTool = { type: 'function'; function: { name: string; description?: string; parameters?: unknown } }

/** Chat-Completions messages → Responses input items. Tool results become function_call_output correlated by call_id. */
export function toResponsesInput(messages: ChatMessage[]): unknown[] {
  const items: unknown[] = []
  for (const m of messages) {
    if (m.role === 'tool') { items.push({ type: 'function_call_output', call_id: m.tool_call_id, output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') }); continue }
    if (m.role === 'assistant') {
      if (typeof m.content === 'string' && m.content) items.push({ role: 'assistant', content: m.content })
      for (const c of m.tool_calls ?? []) items.push({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments || '{}' })
      continue
    }
    items.push({ role: m.role === 'system' ? 'system' : 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '') })
  }
  return items
}

export function toResponsesTools(tools: ChatTool[]): unknown[] {
  return tools.map(t => ({ type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false }))
}

export interface TutorRequest { model: string; maxOutputTokens: number; messages: ChatMessage[]; tools: ChatTool[]; toolChoice: 'auto' | 'none'; effort?: TutorEffort }

/** The exact body sent to the provider. No temperature/top_p; store:false keeps the previous stateless/privacy contract. */
export function buildResponsesBody(r: TutorRequest) {
  return {
    model: r.model,
    input: toResponsesInput(r.messages),
    tools: toResponsesTools(r.tools),
    tool_choice: r.toolChoice,
    max_output_tokens: r.maxOutputTokens,
    reasoning: { effort: r.effort ?? tutorEffort() },
    store: false,
    stream: true,
  }
}

/** Responses stream events → the chat-chunk shape the Tutor engine already reads.
 *  The served model is attached to every chunk once the provider reports it, so the identity gate is unchanged. */
export async function* responsesAsChatChunks(events: AsyncIterable<any>): AsyncGenerator<any> {
  let model = ''
  const index = new Map<string, number>()   // item id → tool index
  const sawArgs = new Set<string>()
  const chunk = (body: any) => ({ ...(model ? { model } : {}), ...body })
  for await (const ev of events) {
    const reported = ev?.response?.model
    if (typeof reported === 'string' && reported) model = reported
    switch (ev?.type) {
      case 'response.created':
      case 'response.in_progress':
        if (model) yield chunk({ choices: [{ delta: {} }] })
        break
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        if (typeof ev.delta === 'string' && ev.delta) yield chunk({ choices: [{ delta: { content: ev.delta } }] })
        break
      case 'response.output_item.added':
        if (ev.item?.type === 'function_call') {
          const i = index.size; index.set(ev.item.id, i)
          yield chunk({ choices: [{ delta: { tool_calls: [{ index: i, id: ev.item.call_id, function: { name: ev.item.name, arguments: '' } }] } }] })
        }
        break
      case 'response.function_call_arguments.delta':
        if (index.has(ev.item_id) && typeof ev.delta === 'string') { sawArgs.add(ev.item_id); yield chunk({ choices: [{ delta: { tool_calls: [{ index: index.get(ev.item_id), function: { arguments: ev.delta } }] } }] }) }
        break
      case 'response.output_item.done':
        // Arguments that arrived only complete (no deltas) are delivered once, never twice.
        if (ev.item?.type === 'function_call' && index.has(ev.item.id) && !sawArgs.has(ev.item.id) && ev.item.arguments) {
          sawArgs.add(ev.item.id)
          yield chunk({ choices: [{ delta: { tool_calls: [{ index: index.get(ev.item.id), function: { arguments: ev.item.arguments } }] } }] })
        }
        break
      case 'response.completed':
      case 'response.incomplete': {
        const u = ev.response?.usage
        yield chunk({ choices: [], ...(u ? { usage: {
          prompt_tokens: u.input_tokens ?? 0,
          completion_tokens: u.output_tokens ?? 0,
          prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens ?? 0 },
          completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens ?? 0 },
        } } : {}) })
        break
      }
      case 'response.failed':
      case 'error':
        // Same outcome as a dropped Chat stream: the engine reports provider_stream_interrupted, never invents text.
        throw new Error('responses_stream_failed')
      default:
        break
    }
  }
}

/** Opens the Responses stream for the Tutor and returns it in the engine's chunk shape. */
export async function createResponsesTutorStream(client: any, r: TutorRequest): Promise<AsyncIterable<any>> {
  const stream = await client.responses.create(buildResponsesBody(r))
  return responsesAsChatChunks(stream)
}
