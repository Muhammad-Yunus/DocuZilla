import { extractText } from 'unpdf';

export type AiAssistantMode = 'GPT-4o' | 'Document AI' | 'Financial AI' | 'Summary';

const MODE_SYSTEM_PROMPTS: Record<AiAssistantMode, string> = {
  'GPT-4o':
    'You are DocuZilla AI, the integrated intelligence assistant for the DocuZilla Enterprise Data Room platform. You have direct read access to the live DocuZilla Workspace Context provided in the prompt (authenticated user profile, reporting hierarchy, projects, documents, approval statuses, KPIs, and RAG-retrieved document contents from RustFS). Answer directly and accurately from that context. Never claim you lack access to platform projects, users, or documents when they are provided in the context. If the current session is not signed in and the user asks about personal ownership ("me"/"my"), explain that they need to sign in first while optionally summarizing the visible workspace items.',
  'Document AI':
    'You are DocuZilla Document AI, connected to the DocuZilla Data Room and RustFS RAG context. Extract structured metadata, key entities, dates, signatories, obligations, and compliance clauses from the attached or RAG-retrieved documents and platform records in clean structured bullets.',
  'Financial AI':
    'You are DocuZilla Financial Audit AI, connected to the DocuZilla Data Room and RustFS RAG context. Analyze financial statements, balance sheets, invoices, discrepancy rates, and month-closure documents across the workspace and uploaded PDFs. Identify numerical discrepancies, variance percentages, reconciliation gaps, and audit findings.',
  Summary:
    'You are DocuZilla Executive Summarizer, connected to the DocuZilla Data Room and RustFS RAG context. Produce a clear, high-signal executive brief covering workspace status, uploaded/retrieved PDF purpose, key metrics, approval readiness, and action items concisely.',
};

function resolveChatCompletionsEndpoint(rawBaseUrl: string): string {
  // Strip invisible zero-width/BOM characters and repair accidental whitespace after scheme (e.g. "https:// host")
  const normalizedRaw = rawBaseUrl
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/(https?:\/\/)\s+/gi, '$1')
    .trim();

  // Check if the secret contains an explicit `OPENAI_BASE_URL = <url>` assignment line
  const explicitAssignMatch = normalizedRaw.match(
    /(?:^|[\r\n])\s*(?:OPENAI_BASE_URL|OPENAI_API_BASE|OPENAI_HOST|BASE_URL|API_HOST|HOST)\s*[:=]\s*["'`“”‘’]?(https?:\/\/[^\s"'`“”‘’<>)}\]]+)/i,
  );

  let cleaned = normalizedRaw
    .replace(/^(?:OPENAI_BASE_URL|OPENAI_API_BASE|OPENAI_HOST|BASE_URL|API_HOST|HOST)\s*[:=]\s*/i, '')
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();

  if (explicitAssignMatch?.[1]) {
    cleaned = explicitAssignMatch[1];
  } else {
    const allUrls =
      cleaned.match(/https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:\/[^\s"'`“”‘’<>)}\]]*)?/gi) || [];
    const validUrls = allUrls.filter((u) => {
      try {
        new URL(u);
        return true;
      } catch {
        return false;
      }
    });
    const candidateUrls = validUrls.filter(
      (u) => !/ais-dev-.*\.run\.app/i.test(u) && !/\/api\/documents\b/i.test(u),
    );
    if (candidateUrls.length === 1) {
      cleaned = candidateUrls[0];
    } else if (candidateUrls.length > 1) {
      const unique = Array.from(new Set(candidateUrls.map((u) => u.replace(/\/+$/, ''))));
      if (unique.length === 1) {
        cleaned = unique[0];
      } else {
        const hosts = unique.map((u) => {
          try {
            return new URL(u).hostname;
          } catch {
            return 'unknown-host';
          }
        });
        throw new Error(
          `OPENAI_BASE_URL in Secrets contains ${unique.length} different URLs (${hosts.join(', ')}). Please set OPENAI_BASE_URL in Settings > Secrets to a single clean URL.`,
        );
      }
    } else if (validUrls.length === 1) {
      cleaned = validUrls[0];
    } else {
      cleaned = cleaned.split(/[\r\n]+/)[0].trim();
    }
  }

  cleaned = cleaned.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim().replace(/\/+$/, '');

  if (!cleaned) {
    throw new Error('OPENAI_BASE_URL is empty. Configure it in Secrets.');
  }

  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(cleaned)) {
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(cleaned);
    cleaned = `${isLocal ? 'http' : 'https'}://${cleaned}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    const flags = [
      /\s/.test(cleaned) ? 'contains whitespace/newlines' : null,
      /:\/\//.test(cleaned.replace(/^[a-zA-Z]+:\/\//, '')) ? 'contains duplicate scheme' : null,
      /[^\x21-\x7E]/.test(cleaned) ? 'contains non-ASCII characters' : null,
    ].filter(Boolean);
    const hint = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    throw new Error(
      `OPENAI_BASE_URL is not a valid URL${hint}. Please set OPENAI_BASE_URL in Secrets to a single clean URL such as https://api.openai.com/v1`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OPENAI_BASE_URL must use http:// or https://');
  }

  if (/ais-dev-.*\.run\.app$/i.test(parsed.hostname) || /\/api\/documents\b/i.test(parsed.pathname)) {
    throw new Error(
      `OPENAI_BASE_URL in Secrets points to this app's URL (${parsed.hostname}${parsed.pathname}) instead of your AI provider. Please update OPENAI_BASE_URL in Settings > Secrets to your AI host (e.g. https://ai.sumopod.com).`,
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('/chat/completions')) {
    return parsed.toString();
  }
  if (/\/v\d+(?:alpha|beta)?$/i.test(pathname) || /\/openai$/i.test(pathname)) {
    parsed.pathname = `${pathname}/chat/completions`;
    return parsed.toString();
  }
  parsed.pathname = `${pathname}/v1/chat/completions`;
  return parsed.toString();
}

const DEFAULT_OPENAI_BASE_URL = 'https://ai.sumopod.com';

function getConfiguredBaseUrl(): string {
  const candidates = [
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_BASE,
    process.env.OPENAI_HOST,
    process.env.OPENAI_API_HOST,
  ]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));

  const validExternal = candidates.find((v) => {
    if (/ais-dev-.*\.run\.app/i.test(v) || /\/api\/documents\b/i.test(v)) {
      return false;
    }
    try {
      resolveChatCompletionsEndpoint(v);
      return true;
    } catch {
      return false;
    }
  });

  return validExternal || DEFAULT_OPENAI_BASE_URL;
}

export function isAiConfigured(): boolean {
  return Boolean(getConfiguredBaseUrl() && process.env.OPENAI_API_KEY?.trim());
}

async function extractDocumentText(
  fileBuffer: Buffer,
  mimeType?: string,
  fileName?: string,
): Promise<{ text: string; isImage: boolean; imageDataUrl?: string }> {
  const lowerName = (fileName || '').toLowerCase();
  const isPdf = mimeType === 'application/pdf' || lowerName.endsWith('.pdf');
  const isImage = Boolean(mimeType && mimeType.startsWith('image/'));

  if (isImage && mimeType) {
    return {
      text: '',
      isImage: true,
      imageDataUrl: `data:${mimeType};base64,${fileBuffer.toString('base64')}`,
    };
  }

  if (isPdf) {
    try {
      const result = await extractText(new Uint8Array(fileBuffer), { mergePages: true });
      const extracted = typeof result.text === 'string' ? result.text.trim() : '';
      if (!extracted) {
        return {
          text: `[PDF uploaded: ${fileName || 'document.pdf'}, ${result.totalPages || 1} page(s), no machine-readable text layer found (may be a scanned image PDF).]`,
          isImage: false,
        };
      }
      return {
        text: `[PDF File: ${fileName || 'document.pdf'} | Pages: ${result.totalPages || 1}]\n${extracted.slice(0, 60000)}`,
        isImage: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF parsing failed';
      return {
        text: `[Uploaded PDF ${fileName || 'document.pdf'} could not be parsed cleanly: ${msg}]`,
        isImage: false,
      };
    }
  }

  const snippet = fileBuffer.toString('utf8').slice(0, 60000);
  return {
    text: `[Document File: ${fileName || 'document'}]\n${snippet}`,
    isImage: false,
  };
}

const ragTextCache = new Map<string, string>();
const MAX_RAG_CACHE_ENTRIES = 60;

function cacheExtractedText(sha256: string, text: string): void {
  if (!sha256 || !text) return;
  if (ragTextCache.size >= MAX_RAG_CACHE_ENTRIES) {
    const oldestKey = ragTextCache.keys().next().value;
    if (oldestKey) ragTextCache.delete(oldestKey);
  }
  ragTextCache.set(sha256, text);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which', 'who', 'where', 'when',
  'how', 'are', 'was', 'were', 'have', 'has', 'had', 'can', 'could', 'would', 'should', 'will',
  'list', 'show', 'tell', 'give', 'about', 'into', 'your', 'our', 'their', 'all', 'any', 'dan',
  'yang', 'untuk', 'dari', 'ini', 'itu', 'ada', 'apa', 'siapa', 'mana', 'bisa', 'tolong', 'buat',
]);

export interface RagUserInfo {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  title: string;
  managerId: number | null;
  managerName?: string | null;
  canApprove: boolean;
}

export interface RagProjectInfo {
  id: number;
  name: string;
  code: string;
  department: string;
  status: string;
  ownerId: number | null;
  ownerName?: string | null;
  docCount?: number;
  documentCount?: number;
  pendingCount?: number;
  storageUsedBytes: number;
}

export interface RagDocumentInfo {
  id: number;
  projectId: number;
  projectName?: string;
  projectCode?: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  rustfsBucket: string;
  rustfsKey: string;
  sha256: string;
  category: string;
  uploadedById: number;
  uploaderName?: string;
  assignedApproverId: number | null;
  assignedApproverName?: string | null;
  approvalStatus: string;
  approvalNote: string | null;
  discrepancyRate: string | null;
  aiSummary: string | null;
  createdAt: Date | string;
}

export async function buildWorkspaceRagContext(params: {
  question: string;
  currentUser: RagUserInfo | null;
  projects: RagProjectInfo[];
  documents: RagDocumentInfo[];
  users: RagUserInfo[];
  kpis?: Record<string, unknown>;
  excludeDocId?: number | null;
  fetchObjectBuffer: (bucket: string, key: string) => Promise<Buffer | null>;
}): Promise<string> {
  const { question, currentUser, projects, documents, users, kpis, excludeDocId, fetchObjectBuffer } = params;
  const sections: string[] = [];

  // 1. Authenticated User & Personal Ownership Scope
  if (currentUser) {
    const ownedProjects = projects.filter((p) => p.ownerId === currentUser.id);
    const uploadedDocs = documents.filter((d) => d.uploadedById === currentUser.id);
    const pendingToApprove = documents.filter(
      (d) => d.assignedApproverId === currentUser.id && d.approvalStatus === 'pending',
    );
    const directReports = users.filter((u) => u.managerId === currentUser.id);

    sections.push(
      [
        '### Current Authenticated User',
        `- Name: ${currentUser.name} (ID: ${currentUser.id}, Email: ${currentUser.email})`,
        `- Role: ${currentUser.role} | Title: ${currentUser.title} | Department: ${currentUser.department}`,
        `- Approval Authority: ${currentUser.canApprove ? 'Yes' : 'No'} | Direct Manager: ${currentUser.managerName || 'None (Top-Level)'}`,
        `- Projects Owned by Current User (${ownedProjects.length}): ${
          ownedProjects.length > 0
            ? ownedProjects.map((p) => `[#${p.id} ${p.code}] ${p.name} (${p.status})`).join('; ')
            : 'None'
        }`,
        `- Documents Uploaded by Current User (${uploadedDocs.length}): ${
          uploadedDocs.length > 0
            ? uploadedDocs.map((d) => `[#${d.id}] ${d.title} (${d.fileName}, status: ${d.approvalStatus})`).join('; ')
            : 'None'
        }`,
        `- Pending Approvals Assigned to Current User (${pendingToApprove.length}): ${
          pendingToApprove.length > 0
            ? pendingToApprove.map((d) => `[#${d.id}] ${d.title} from ${d.uploaderName || 'Unknown'}`).join('; ')
            : 'None'
        }`,
        `- Direct Reports (${directReports.length}): ${
          directReports.length > 0 ? directReports.map((u) => `${u.name} (${u.role})`).join(', ') : 'None'
        }`,
      ].join('\n'),
    );
  } else {
    sections.push(
      [
        '### Current Session Identity',
        '- Status: Not signed in (Guest session).',
        '- Note: If the user asks about "my projects" or "belong to me", explain clearly that they are not signed in yet (so personal ownership cannot be matched until they click Sign In), and optionally summarize the platform projects and their owners below.',
      ].join('\n'),
    );
  }

  // 2. KPI Summary
  if (kpis) {
    sections.push(
      `### Platform KPI Snapshot\n- Active Projects: ${kpis.activeProjects ?? projects.length} | Total Users: ${kpis.totalUsers ?? users.length} | Total Documents: ${kpis.totalDocuments ?? documents.length} | Data Room Size (GB): ${kpis.dataRoomSizeGb ?? 0} | Pending Reviews: ${kpis.pendingReviews ?? 0}`,
    );
  }

  // 3. Projects Directory
  if (projects.length > 0) {
    const projectLines = projects.map(
      (p) =>
        `- [Project #${p.id}] ${p.code} — ${p.name} | Dept: ${p.department} | Status: ${p.status} | Owner: ${p.ownerName || (p.ownerId ? `User #${p.ownerId}` : 'Unassigned')} | Docs: ${p.docCount ?? p.documentCount ?? 0} (Pending: ${p.pendingCount ?? 0})`,
    );
    sections.push(`### DocuZilla Projects (${projects.length})\n${projectLines.join('\n')}`);
  } else {
    sections.push('### DocuZilla Projects\n- No projects found in workspace.');
  }

  // 4. Users & 1-Level Reporting Hierarchy
  if (users.length > 0) {
    const userLines = users.map(
      (u) =>
        `- [User #${u.id}] ${u.name} (${u.email}) | Role: ${u.role} | Title: ${u.title} | Dept: ${u.department} | Reports To: ${u.managerName || 'Top-Level'} | Can Approve: ${u.canApprove ? 'Yes' : 'No'}`,
    );
    sections.push(`### Team & Approval Hierarchy (${users.length})\n${userLines.join('\n')}`);
  }

  // 5. Document Catalog (metadata + AI summaries)
  const catalogDocs = documents.slice(0, 50);
  if (catalogDocs.length > 0) {
    const docLines = catalogDocs.map(
      (d) =>
        `- [Doc #${d.id}] "${d.title}" (${d.fileName}) | Project: ${d.projectCode || ''} ${d.projectName || ''} | Category: ${d.category} | Status: ${d.approvalStatus} | Uploader: ${d.uploaderName || d.uploadedById} | Approver: ${d.assignedApproverName || 'Unassigned'} | Discrepancy: ${d.discrepancyRate || '0.00%'} | Size: ${Math.round(d.sizeBytes / 1024)} KB | Summary: ${d.aiSummary || 'N/A'}`,
    );
    sections.push(`### Data Room Documents Catalog (${documents.length})\n${docLines.join('\n')}`);
  } else {
    sections.push('### Data Room Documents Catalog\n- No documents uploaded yet.');
  }

  // 6. Real-Time RAG Retrieval over RustFS File Contents
  const qLower = question.toLowerCase();
  const tokens = Array.from(
    new Set(
      qLower
        .split(/[^a-z0-9._-]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t)),
    ),
  );

  const personalQuery = /\b(my|me|mine|saya|aku|punyaku|milikku)\b/i.test(qLower);
  const pendingQuery = /\b(pending|approve|approval|review|menunggu)\b/i.test(qLower);

  const scoredDocs = documents
    .filter((d) => d.id !== excludeDocId && d.sizeBytes > 0 && d.sizeBytes <= 15 * 1024 * 1024)
    .map((d) => {
      let score = 0;
      const primaryHay = `${d.title} ${d.fileName} ${d.projectName || ''} ${d.projectCode || ''}`.toLowerCase();
      const secondaryHay = `${d.category} ${d.aiSummary || ''} ${d.uploaderName || ''} ${d.assignedApproverName || ''} ${d.approvalStatus}`.toLowerCase();

      for (const tok of tokens) {
        if (primaryHay.includes(tok)) score += 6;
        else if (secondaryHay.includes(tok)) score += 3;
      }
      if (personalQuery && currentUser && (d.uploadedById === currentUser.id || d.assignedApproverId === currentUser.id)) {
        score += 5;
      }
      if (pendingQuery && d.approvalStatus === 'pending') {
        score += 4;
      }
      return { doc: d, score };
    })
    .sort((a, b) => b.score - a.score || b.doc.id - a.doc.id);

  // Pick top 3 matched docs (or top 2 recent docs if query looks document-related)
  const docRelatedQuery =
    scoredDocs.some((s) => s.score > 0) ||
    /\b(doc|document|documents|file|files|pdf|content|isi|summary|ringkas|baca|read|analyze|audit|schematic|invoice|ledger|report)\b/i.test(
      qLower,
    );

  if (docRelatedQuery && scoredDocs.length > 0) {
    const topCandidates = scoredDocs.slice(0, 3).map((s) => s.doc);
    const extractedResults = await Promise.allSettled(
      topCandidates.map(async (doc) => {
        let extractedText = doc.sha256 ? ragTextCache.get(doc.sha256) : undefined;
        if (!extractedText) {
          const buf = await fetchObjectBuffer(doc.rustfsBucket, doc.rustfsKey);
          if (!buf || buf.length === 0) return null;
          if (doc.mimeType?.startsWith('image/')) {
            extractedText = `[Image file stored in RustFS: ${doc.fileName} (${doc.mimeType}), ${Math.round(doc.sizeBytes / 1024)} KB]`;
          } else {
            const parsed = await extractDocumentText(buf, doc.mimeType, doc.fileName);
            extractedText = parsed.text.slice(0, 6000);
          }
          if (doc.sha256 && extractedText) {
            cacheExtractedText(doc.sha256, extractedText);
          }
        }
        return extractedText ? { doc, text: extractedText } : null;
      }),
    );

    const ragSnippets: string[] = [];
    let totalChars = 0;
    for (const res of extractedResults) {
      if (res.status === 'fulfilled' && res.value) {
        const snippet = res.value.text.slice(0, 6000);
        if (totalChars + snippet.length > 18000) break;
        totalChars += snippet.length;
        ragSnippets.push(
          `#### [Doc #${res.value.doc.id}] ${res.value.doc.fileName} (Project: ${res.value.doc.projectCode || ''} ${res.value.doc.projectName || ''})\n${snippet}`,
        );
      }
    }

    if (ragSnippets.length > 0) {
      sections.push(`### Retrieved Document Contents (RustFS RAG)\n${ragSnippets.join('\n\n')}`);
    }
  }

  return sections.join('\n\n');
}

export async function processDocumentWithOpenAiCompatible(params: {
  question: string;
  mode: AiAssistantMode;
  fileBuffer?: Buffer | null;
  mimeType?: string;
  fileName?: string;
  documentContextText?: string;
  workspaceContextText?: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const baseUrl = getConfiguredBaseUrl();
  const rawApiKey = process.env.OPENAI_API_KEY
    ?.replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^(?:OPENAI_API_KEY|API_KEY)\s*[:=]\s*/i, '')
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();

  if (!baseUrl || !rawApiKey) {
    throw new Error(
      'OpenAI-Compatible API is not configured. Please set OPENAI_BASE_URL and OPENAI_API_KEY in Settings > Secrets.',
    );
  }

  const apiKey = rawApiKey;
  const endpoint = resolveChatCompletionsEndpoint(baseUrl);
  const model =
    process.env.OPENAI_MODEL
      ?.replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .replace(/^(?:OPENAI_MODEL|MODEL)\s*[:=]\s*/i, '')
      .trim()
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
      .trim() || 'gpt-4o';
  const systemInstruction = MODE_SYSTEM_PROMPTS[params.mode] || MODE_SYSTEM_PROMPTS['GPT-4o'];

  const textSections: string[] = [];
  let imageDataUrl: string | undefined;

  if (params.workspaceContextText) {
    textSections.push(`DocuZilla Live Workspace & RAG Context:\n${params.workspaceContextText}`);
  }

  if (params.fileBuffer && params.fileBuffer.length > 0) {
    const extracted = await extractDocumentText(params.fileBuffer, params.mimeType, params.fileName);
    if (extracted.isImage && extracted.imageDataUrl) {
      imageDataUrl = extracted.imageDataUrl;
    } else if (extracted.text) {
      textSections.push(`Attached / Selected Document Content:\n${extracted.text}`);
    }
  }

  if (params.documentContextText) {
    textSections.push(`Selected Data Room Document Metadata:\n${params.documentContextText}`);
  }

  textSections.push(
    `User Request:\n${params.question.trim() || 'Analyze this document and provide key insights.'}`,
  );

  const combinedText = textSections.join('\n\n---\n\n');
  const userContent = imageDataUrl
    ? [
        { type: 'text', text: combinedText },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ]
    : combinedText;

  const historyMessages = (params.conversationHistory || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        ...historyMessages,
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || 'unknown';
  const endpointPath = (() => {
    try {
      return new URL(endpoint).pathname;
    } catch {
      return '/chat/completions';
    }
  })();

  let parsed: {
    choices?: Array<{
      finish_reason?: string;
      text?: string;
      message?: {
        content?: string | Array<{ text?: string; type?: string }> | null;
        reasoning_content?: string | null;
        reasoning?: string | null;
      };
    }>;
    output_text?: string;
    error?: { message?: string; code?: string | number } | string;
    message?: string;
    msg?: string;
  } = {};

  let isJson = false;
  try {
    parsed = JSON.parse(rawText);
    isJson = true;
  } catch {
    // Some OpenAI-compatible gateways return SSE even when stream isn't requested
    if (rawText.includes('data:')) {
      const sseParts: string[] = [];
      for (const line of rawText.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        if (!trimmedLine.startsWith('data:')) continue;
        const payload = trimmedLine.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
          if (typeof delta === 'string') sseParts.push(delta);
        } catch {
          // ignore non-JSON SSE line
        }
      }
      const sseJoined = sseParts.join('').trim();
      if (sseJoined) return sseJoined;
    }

    const preview = rawText.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(
      `OpenAI-Compatible API returned non-JSON response (HTTP ${response.status}, ${contentType}, path=${endpointPath}): ${preview || '<empty body>'}`,
    );
  }

  const providerErr =
    (typeof parsed.error === 'object' ? parsed.error?.message : parsed.error) ||
    (!response.ok ? parsed.message || parsed.msg : undefined);

  if (!response.ok || parsed.error) {
    throw new Error(
      `OpenAI-Compatible API error (HTTP ${response.status}, path=${endpointPath}): ${providerErr || `HTTP ${response.status}`}`,
    );
  }

  const firstChoice = parsed.choices?.[0];
  const content = firstChoice?.message?.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const joined = content.map((part) => part.text || '').join('').trim();
    if (joined) return joined;
  }

  const fallbackText =
    firstChoice?.message?.reasoning_content ||
    firstChoice?.message?.reasoning ||
    firstChoice?.text ||
    parsed.output_text;

  if (typeof fallbackText === 'string' && fallbackText.trim().length > 0) {
    return fallbackText.trim();
  }

  const topKeys = isJson && parsed && typeof parsed === 'object' ? Object.keys(parsed).join(',') : 'none';
  const finishReason = firstChoice?.finish_reason || 'unknown';
  throw new Error(
    `OpenAI-Compatible API returned an empty completion (HTTP ${response.status}, path=${endpointPath}, model=${model}, keys=[${topKeys}], finish_reason=${finishReason}).`,
  );
}
