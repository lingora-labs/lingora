import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { dispatchTool, toolCatalog } from '../../../lib/engineering/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  });
}

function jsonRpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
) {
  return NextResponse.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  });
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.LINGORA_MCP_TOKEN;

  if (!expected) {
    return false;
  }

  const authorization = req.headers.get('authorization') || '';
  const prefix = 'Bearer ';

  if (!authorization.startsWith(prefix)) {
    return false;
  }

  const supplied = authorization.slice(prefix.length);

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function inputSchemaFor(name: string) {
  switch (name) {
    case 'repo_status':
    case 'list_branches':
      return {
        type: 'object',
        properties: {},
        additionalProperties: false,
      };

    case 'list_tree':
      return {
        type: 'object',
        properties: {
          ref: { type: 'string' },
        },
        additionalProperties: false,
      };

    case 'read_file':
      return {
        type: 'object',
        properties: {
          path: { type: 'string' },
          ref: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      };

    case 'read_files':
      return {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
          },
          ref: { type: 'string' },
        },
        required: ['paths'],
        additionalProperties: false,
      };

    case 'get_commit':
      return {
        type: 'object',
        properties: {
          sha: { type: 'string' },
        },
        additionalProperties: false,
      };

    case 'compare_refs':
      return {
        type: 'object',
        properties: {
          base: { type: 'string' },
          head: { type: 'string' },
        },
        required: ['head'],
        additionalProperties: false,
      };

    case 'write_file':
      return {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
          message: { type: 'string' },
          branch: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      };

    case 'write_files':
      return {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
              additionalProperties: false,
            },
          },
          message: { type: 'string' },
          branch: { type: 'string' },
        },
        required: ['files'],
        additionalProperties: false,
      };

    case 'delete_file':
      return {
        type: 'object',
        properties: {
          path: { type: 'string' },
          message: { type: 'string' },
          branch: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      };

    case 'create_branch':
      return {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          from_branch: { type: 'string' },
        },
        required: ['branch'],
        additionalProperties: false,
      };

    case 'rollback_commit':
      return {
        type: 'object',
        properties: {
          sha: { type: 'string' },
          branch: { type: 'string' },
        },
        additionalProperties: false,
      };

    case 'create_pull_request':
      return {
        type: 'object',
        properties: {
          title: { type: 'string' },
          head: { type: 'string' },
          base: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['title', 'head'],
        additionalProperties: false,
      };

    case 'get_pull_request':
    case 'merge_pull_request':
      return {
        type: 'object',
        properties: {
          number: { type: 'number' },
        },
        required: ['number'],
        additionalProperties: false,
      };

    case 'list_pull_requests':
      return {
        type: 'object',
        properties: {
          state: {
            type: 'string',
            enum: ['open', 'closed', 'all'],
          },
        },
        additionalProperties: false,
      };

    default:
      return {
        type: 'object',
        additionalProperties: true,
      };
  }
}

function mcpTools() {
  return toolCatalog().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchemaFor(tool.name),
  }));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  return NextResponse.json({
    service: 'LINGORA Engineering Gateway',
    protocol: 'MCP',
    transport: 'Streamable HTTP',
    ready: true,
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'Unauthorized',
        },
      },
      { status: 401 },
    );
  }

  let rpc: JsonRpcRequest;

  try {
    rpc = (await req.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(
      null,
      -32700,
      'Parse error',
    );
  }

  if (rpc.jsonrpc !== '2.0' || !rpc.method) {
    return jsonRpcError(
      rpc.id,
      -32600,
      'Invalid Request',
    );
  }

  try {
    switch (rpc.method) {
      case 'initialize':
        return jsonRpcResult(rpc.id, {
          protocolVersion: '2025-03-26',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'lingora-engineering-gateway',
            version: '5.0.0',
          },
        });

      case 'notifications/initialized':
        return new NextResponse(null, {
          status: 202,
        });

      case 'ping':
        return jsonRpcResult(rpc.id, {});

      case 'tools/list':
        return jsonRpcResult(rpc.id, {
          tools: mcpTools(),
        });

      case 'tools/call': {
        const params = rpc.params || {};
        const name = String(params.name || '');
        const args =
          params.arguments &&
          typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {};

        if (!name) {
          return jsonRpcError(
            rpc.id,
            -32602,
            'Missing tool name',
          );
        }

        const result = await dispatchTool(name, args);

        return jsonRpcResult(rpc.id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
          isError: false,
        });
      }

      default:
        return jsonRpcError(
          rpc.id,
          -32601,
          `Method not found: ${rpc.method}`,
        );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return jsonRpcResult(rpc.id, {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    });
  }
}
