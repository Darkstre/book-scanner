// GitHub Contents API from the browser (api.github.com allows it). The token is the person's own, kept only in this
// browser (localStorage); the page itself has no keys. Queue writes are read-modify-write with the file's sha and
// retry on conflicts, so the phone app, the desktop and this page can all add to queue.jsonl at the same time.

const API = 'https://api.github.com';

export class GitHub {
  constructor(owner, token) { this.owner = owner; this.token = token; }

  async req(method, path, body) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404) return null;
    if (!r.ok) {
      const msg = (await r.json().catch(() => ({}))).message || r.statusText;
      const e = new Error(`GitHub ${r.status}: ${msg}`); e.status = r.status; throw e;
    }
    return r.status === 204 ? {} : r.json();
  }

  /** Can this token write to the repo? Returns a short human-readable answer. */
  async test(repo) {
    const r = await this.req('GET', `/repos/${this.owner}/${repo}`);
    if (!r) return `Can't see ${this.owner}/${repo} - check the username, the repository name and the token's access.`;
    return r.permissions?.push ? `Connected to ${repo} (can add books).` : `Connected to ${repo}, but this token can't write to it.`;
  }

  async getText(repo, path) {
    const r = await this.req('GET', `/repos/${this.owner}/${repo}/contents/${path}`);
    if (!r) return { text: null, sha: null };
    let text;
    if (r.content) text = new TextDecoder().decode(Uint8Array.from(atob(r.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
    else text = await (await fetch(r.download_url, { headers: { Authorization: `Bearer ${this.token}` } })).text();   // over 1 MB
    return { text, sha: r.sha };
  }

  async putBytes(repo, path, bytes, message, sha) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return this.req('PUT', `/repos/${this.owner}/${repo}/contents/${path}`, { message, content: btoa(bin), ...(sha ? { sha } : {}) });
  }

  /** Appends one line to a text file, retrying when someone else wrote in between. */
  async appendLine(repo, path, line, message) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { text, sha } = await this.getText(repo, path);
      const body = (text || '').replace(/\r/g, '');
      const next = (body && !body.endsWith('\n') ? body + '\n' : body) + line + '\n';
      try {
        return await this.putBytes(repo, path, new TextEncoder().encode(next), message, sha);
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      }
    }
    throw new Error('The queue kept changing while saving; try again.');
  }
}
