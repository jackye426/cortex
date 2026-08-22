import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSessionPage } from "./parse.js";
import type { SessionDetail } from "./types.js";

export interface ListedPage {
  absolutePath: string;
  relativePath: string;
  markdown: string;
}

export function listMarkdownPages(root: string): ListedPage[] {
  const out: ListedPage[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      const markdown = readFileSync(full, "utf8");
      out.push({
        absolutePath: full,
        relativePath: relative(root, full).replace(/\\/g, "/"),
        markdown,
      });
    }
  };
  walk(root);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

export function parsePagesInDir(root: string): Array<{
  relativePath: string;
  slug: string;
  detail: SessionDetail;
}> {
  const out: Array<{
    relativePath: string;
    slug: string;
    detail: SessionDetail;
  }> = [];
  for (const page of listMarkdownPages(root)) {
    if (!/^---/.test(page.markdown)) continue;
    if (!/cortex_schema:\s*session-v1/.test(page.markdown.slice(0, 800))) {
      continue;
    }
    try {
      const detail = parseSessionPage(page.markdown);
      const slug = page.relativePath.replace(/\.md$/, "");
      out.push({ relativePath: page.relativePath, slug, detail });
    } catch {
      /* skip unreadable pages */
    }
  }
  return out;
}
