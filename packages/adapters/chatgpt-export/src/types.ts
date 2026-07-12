/**
 * Loose types for OpenAI ChatGPT official data-export conversations.json.
 * The export schema drifts; fields are optional and defensively parsed.
 */

export interface ChatgptExportAuthor {
  role?: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChatgptExportContent {
  content_type?: string;
  parts?: unknown[];
  text?: string;
  language?: string;
  result?: string;
}

export interface ChatgptExportMessage {
  id?: string;
  author?: ChatgptExportAuthor;
  create_time?: number | null;
  update_time?: number | null;
  content?: ChatgptExportContent;
  status?: string;
  end_turn?: boolean | null;
  weight?: number;
  metadata?: Record<string, unknown>;
  recipient?: string;
}

export interface ChatgptExportMappingNode {
  id?: string;
  message?: ChatgptExportMessage | null;
  parent?: string | null;
  children?: string[];
}

export interface ChatgptExportConversation {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  current_node?: string | null;
  mapping?: Record<string, ChatgptExportMappingNode>;
  /** Some exports nest under this key. */
  conversation_template_id?: string | null;
  gizmo_id?: string | null;
  default_model_slug?: string | null;
}

export type ChatgptExportFile = ChatgptExportConversation[];
