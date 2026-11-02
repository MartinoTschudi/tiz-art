/**
 * The admin's data layer: the GitHub repository of the website is the database.
 *
 *   src/content/opere/<slug>/opera.json + its photos   one folder per artwork
 *   src/content/profilo/profilo.json (+ portrait)       the "Chi sono" page
 *
 * Reading always goes to the GitHub API (the deployed site can be minutes behind).
 * Every save is ONE commit; the push starts .github/workflows/deploy.yml, which rebuilds and
 * publishes the site. Photos are uploaded as blobs once, before the commit, so a retry on a moved
 * branch only rebuilds the small JSON part; «Riprova» reuses the photos already uploaded too.
 *
 * Saving twice must never do harm:
 *  - a new photo keeps the same random part in its file name (`upload.id`, kept in the draft), so a
 *    new work whose first save reached GitHub without the phone knowing (answer lost, page closed)
 *    is recognised by its photos and saved into the same folder instead of creating a copy;
 *  - an edit carries `base`, the `aggiornataIl` / `aggiornatoIl` of the version the form was opened
 *    with: if the file changed since, the save stops instead of silently undoing that change
 *    (unless the file already holds exactly this edit: then an earlier attempt worked).
 */
import { GitHubClient, GitHubError, KEY_INVALID_MESSAGE } from './github.js';
import {
  OPERE_DIR, PROFILO_DIR, OPERA_FILE, PROFILO_FILE,
  slugify, uniqueSlug, validateOpera, validateProfilo, serializeOpera, serializeProfilo, normalizeOpera,
  compareOpere, nextOrdine, imageFileName, portraitFileName, commitMessage, imageRefName,
} from './model.js';
import { mapLimit, randomId } from './util.js';

export const WORKFLOW_FILE = 'deploy.yml';
const CACHE_PREFIX = 'tiz-admin:blob:';

/** A save that would break the rules: plain Italian message, nothing was written. */
export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
    this.kind = 'store';
  }
}

/** Long-lived cache of JSON texts by blob SHA (a SHA never changes content). */
export const browserCache = {
  get(sha) {
    try {
      return localStorage.getItem(CACHE_PREFIX + sha);
    } catch {
      return null;
    }
  },
  set(sha, text) {
    try {
      localStorage.setItem(CACHE_PREFIX + sha, text);
    } catch {
      /* storage full or disabled: the cache is only an optimisation */
    }
  },
  /** Forgets the texts that are no longer part of the repository. */
  prune(keepShas) {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX) && !keepShas.has(key.slice(CACHE_PREFIX.length))) localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  },
  clear() {
    this.prune(new Set());
  },
};

/** Workflow run → 'running' | 'online' | 'error' | null (cancelled / skipped: nothing to say). */
export function runState(run) {
  if (!run) return null;
  if (run.status !== 'completed') return 'running';
  if (run.conclusion === 'success') return 'online';
  if (['failure', 'timed_out', 'startup_failure', 'action_required'].includes(run.conclusion)) return 'error';
  return null;
}

/**
 * The loaded data (Store.load) with a save of this phone already in it: the reload that follows
 * takes a moment (longer on a slow connection, and it can fail), and a screen opened meanwhile must
 * show what was saved, or saving it again would silently undo the first save.
 * @param {{opere: Array<{slug: string, data: object, outdated?: boolean}>, profilo: object|null}} data
 * @param {{action: string, slug?: string, opera?: object, profilo?: object}} result  of saveOpera / deleteOpera / saveProfilo
 */
export function withSaved(data, result) {
  if (result.action === 'profilo') return { ...data, profilo: result.profilo };
  const opere = data.opere.filter((o) => o.slug !== result.slug);
  if (result.action === 'create' || result.action === 'update') {
    const files = new Set([OPERA_FILE, ...result.opera.immagini.map(imageRefName)]);
    opere.push({ slug: result.slug, sha: null, files, data: result.opera, outdated: false });
    opere.sort(compareOpere);
  }
  return { ...data, opere };
}

/**
 * The loaded data with the new order of reorder() (`ordini`: slug → ordine). reorder() rewrote the
 * works whose `ordine` changed in the current format, so those are no longer `outdated`.
 */
export function withOrder(data, ordini) {
  const opere = data.opere
    .map((o) => {
      const ordine = ordini[o.slug];
      if (ordine === undefined) return o;
      return { ...o, data: { ...o.data, ordine }, outdated: Boolean(o.outdated) && o.data.ordine === ordine };
    })
    .sort(compareOpere);
  return { ...data, opere };
}

function assertValid(problems, what) {
  if (problems.length) {
    throw new StoreError(`Non posso salvare ${what}: ${problems[0]}. Controlla i campi e riprova.`);
  }
}

/** Thumbnail index published by the site (section 6); null when missing. */
async function fetchThumbnailIndex(env) {
  const res = await fetch(`${env.adminBase}anteprime.json`, { cache: 'no-cache' });
  if (!res.ok) return null;
  const json = await res.json();
  return json && typeof json === 'object' ? json : null;
}

/** Only same-origin absolute paths from the index are used as image URLs. */
const isSitePath = (v) => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//');

/** The file of a folder that holds the new photo with this random id ("03-k2x9qa.jpg"), or null. */
const fileWithId = (files, id) => [...files].find((f) => f.endsWith(`-${id}.jpg`)) || null;

/** Same artwork apart from the time of the save? */
const sameOpera = (a, b) => serializeOpera({ ...a, aggiornataIl: '' }) === serializeOpera({ ...b, aggiornataIl: '' });
const sameProfilo = (a, b) => serializeProfilo({ ...a, aggiornatoIl: '' }) === serializeProfilo({ ...b, aggiornatoIl: '' });

export const CHANGED_MEANWHILE_OPERA = 'Quest’opera è stata cambiata dopo che l’hai aperta. Torna alle opere, tocca ↻ e riaprila.';
export const CHANGED_MEANWHILE_PROFILO = 'Il profilo è stato cambiato dopo che l’hai aperto. Torna alle opere, tocca ↻ e riaprilo.';

export class Store {
  /**
   * @param {{owner: string, repo: string, branch: string, token: string}} session
   * @param {ReturnType<import('./env.js').resolveEnv>} env
   * @param {{fetchImpl?: Function, cache?: object|null, fetchIndex?: Function, now?: () => Date, retryDelay?: number}} [options]
   *   all injectable for tests
   */
  constructor(session, env, { fetchImpl, cache = browserCache, fetchIndex, now = () => new Date(), retryDelay } = {}) {
    this.owner = session.owner;
    this.repo = session.repo;
    this.branch = session.branch || 'main';
    this.env = env;
    this.cache = cache;
    this.gh = new GitHubClient({ ...session, apiBase: env.apiBase }, { fetchImpl, persist: cache, retryDelay });
    this.fetchIndex = fetchIndex || (() => fetchThumbnailIndex(env));
    this.now = now;
    this.head = null; // branch tip seen by the last load
    this.index = null; // anteprime.json
    this.previews = new Map(); // repo path → object URL of a photo uploaded from this device
    this.uploaded = new WeakMap(); // photo Blob → blob SHA already on GitHub (a retry skips the upload)
  }

  /** Throws a GitHubError when the key cannot read (or cannot write to) the repository. */
  async verify() {
    const info = await this.gh.getRepo();
    if (info && info.permissions && info.permissions.push === false) {
      throw new GitHubError(KEY_INVALID_MESSAGE, { status: 403, kind: 'forbidden' });
    }
  }

  /* ---------- reading ---------- */

  /**
   * Every artwork folder of a tree: Map(slug → { slug, sha (of opera.json) | null, files: Set(names) }).
   */
  static folders(files) {
    const folders = new Map();
    const prefix = `${OPERE_DIR}/`;
    for (const [path, entry] of files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) continue;
      const slug = rest.slice(0, slash);
      const name = rest.slice(slash + 1);
      if (!folders.has(slug)) folders.set(slug, { slug, sha: null, files: new Set() });
      const folder = folders.get(slug);
      folder.files.add(name);
      if (name === OPERA_FILE) folder.sha = entry.sha;
    }
    return folders;
  }

  /**
   * Reads every opera.json of a tree. A broken file is reported, it never blocks the list.
   * Each work is { slug, sha, files, data, outdated }: `data` is normalised (normalizeOpera: a file
   * saved before `colore` existed reads as colore null), and `outdated` is true when the file is not
   * exactly what the admin would write for it, so «Salva» rewrites it even without a change.
   */
  async readOpere(files) {
    const folders = Store.folders(files);
    const problems = [];
    const read = await mapLimit([...folders.values()], 6, async (folder) => {
      if (!folder.sha) {
        problems.push(`La cartella «${folder.slug}» non contiene opera.json.`);
        return null;
      }
      let text;
      let data;
      try {
        text = await this.gh.readText(folder.sha);
        data = normalizeOpera(JSON.parse(text));
      } catch (err) {
        if (err instanceof GitHubError) throw err;
        problems.push(`I dati dell’opera «${folder.slug}» non sono leggibili.`);
        return null;
      }
      const invalid = validateOpera(data);
      if (invalid.length) problems.push(`L’opera «${folder.slug}» ha dati non validi (${invalid[0]}).`);
      return { ...folder, data, outdated: !invalid.length && serializeOpera(data) !== text };
    });
    return { folders, opere: read.filter(Boolean).sort(compareOpere), problems };
  }

  async readProfilo(files) {
    const entry = files.get(`${PROFILO_DIR}/${PROFILO_FILE}`);
    if (!entry) return null;
    try {
      return { sha: entry.sha, data: JSON.parse(await this.gh.readText(entry.sha)) };
    } catch (err) {
      if (err instanceof GitHubError) throw err;
      return null;
    }
  }

  /**
   * Loads everything the admin shows.
   * @returns {Promise<{head: object, opere: Array<{slug: string, data: object, files: Set<string>, outdated: boolean}>,
   *                    profilo: object|null, problems: string[]}>}  (see readOpere)
   */
  async load() {
    const index = Promise.resolve()
      .then(() => this.fetchIndex())
      .catch(() => null); // thumbnails are optional
    const head = await this.gh.getHead();
    const files = await this.gh.listFiles(head.treeSha);
    const [{ opere, problems }, profilo] = await Promise.all([this.readOpere(files), this.readProfilo(files)]);
    this.head = head;
    this.index = await index;
    if (this.cache && this.cache.prune) {
      this.cache.prune(new Set([...opere.map((o) => o.sha), profilo && profilo.sha].filter(Boolean)));
    }
    return { head, opere, profilo: profilo && profilo.data, problems };
  }

  /* ---------- images ---------- */

  /** Where to show a repository image from, best first: this device's copy, the site's thumbnail, the raw file. */
  imageSources(path, indexed) {
    const sources = [];
    if (this.previews.has(path)) sources.push(this.previews.get(path));
    if (isSitePath(indexed)) sources.push(indexed);
    if (this.head) sources.push(this.env.rawUrl(this.owner, this.repo, this.head.commitSha, path));
    return sources;
  }

  /** @param {string} ref  "./01.jpg" as written in opera.json */
  operaImageSources(slug, ref) {
    const name = imageRefName(ref);
    if (!name) return [];
    const indexed = this.index && this.index.opere && this.index.opere[slug] && this.index.opere[slug].immagini;
    return this.imageSources(`${OPERE_DIR}/${slug}/${name}`, indexed && indexed[ref]);
  }

  portraitSources(ref) {
    const name = imageRefName(ref);
    if (!name) return [];
    const indexed = this.index && this.index.profilo && this.index.profilo.ritratto;
    return this.imageSources(`${PROFILO_DIR}/${name}`, indexed && indexed[ref]);
  }

  /** Frees the object URLs of uploaded photos (logout). */
  dispose() {
    for (const url of this.previews.values()) URL.revokeObjectURL(url);
    this.previews.clear();
  }

  /**
   * Uploads the new photos (blobs do not depend on the branch: done once, before the commit).
   * A photo uploaded by an earlier attempt of this session is not sent again (blobs are content
   * addressed, so its SHA stays valid). `onProgress` gets `done` = photos finished so far.
   */
  async uploadPhotos(uploads, onProgress) {
    const shas = [];
    // One at a time: phones on mobile data cope better, and each photo is 1–3 MB of base64.
    for (const upload of uploads) {
      onProgress({ phase: 'upload', done: shas.length, total: uploads.length });
      let sha = this.uploaded.get(upload.blob);
      if (!sha) {
        sha = await this.gh.createBlob(upload.blob);
        this.uploaded.set(upload.blob, sha);
      }
      shas.push(sha);
    }
    onProgress({ phase: 'upload', done: shas.length, total: uploads.length });
    return shas;
  }

  /* ---------- writing ---------- */

  /**
   * Creates (slug = null) or updates an artwork. One commit.
   * @param {{slug: string|null, fields: object, photos: Array<{file: string} | {upload: {blob: Blob, preview?: Blob, id?: string}}>,
   *          base?: string|null}} change
   *   fields = parseOperaForm(...).fields; photos in display order (the first is the cover);
   *   base = `aggiornataIl` of the version the form was opened with (edits only)
   * @param {(p: {phase: 'upload'|'commit', done?: number, total?: number}) => void} [onProgress]
   * @returns {Promise<{action: 'create'|'update', slug: string, opera: object, commitSha: string}>}
   */
  async saveOpera({ slug, fields, photos, base = null }, onProgress = () => {}) {
    const isNew = !slug;
    // The random part of a new photo's name is chosen once per photo (normally when it is prepared,
    // see photos.js), so every attempt of this save uses the same file names.
    for (const p of photos) if (p.upload && !p.upload.id) p.upload.id = randomId(6);
    const names = photos.map((p, i) => (p.upload ? imageFileName(i + 1, p.upload.id) : p.file));
    if (new Set(names).size !== names.length) throw new StoreError('La stessa foto compare due volte: togline una.');
    const uploadIdx = photos.map((p, i) => (p.upload ? i : -1)).filter((i) => i >= 0);
    const shas = await this.uploadPhotos(uploadIdx.map((i) => photos[i].upload), onProgress);

    onProgress({ phase: 'commit' });
    let result = null;
    let saved = names; // file names as committed
    const done = await this.gh.commit({
      prepare: async (head) => {
        const files = await this.gh.listFiles(head.treeSha);
        const { folders, opere } = await this.readOpere(files);
        let target = slug;
        let previous = null;
        if (isNew) {
          // A folder that already holds one of these new photos was created by an earlier attempt of
          // this same save (the phone never got the answer): save into it, never a second copy.
          previous = opere.find((o) => uploadIdx.some((i) => fileWithId(o.files, photos[i].upload.id))) || null;
          target = previous ? previous.slug : uniqueSlug(slugify(fields.titolo), new Set(folders.keys()));
        } else {
          previous = opere.find((o) => o.slug === slug);
          if (!previous) throw new StoreError('Quest’opera non esiste più: forse è stata eliminata da un altro dispositivo.');
        }
        const dir = `${OPERE_DIR}/${target}/`;
        for (const [i, p] of photos.entries()) {
          if (!p.upload && !files.has(dir + p.file)) {
            throw new StoreError(`La foto ${i + 1} non esiste più: toglila con × e aggiungila di nuovo.`);
          }
        }
        // A new photo already in the folder keeps its name (the earlier attempt may have numbered it differently).
        const fileNames = names.map((n, i) => (photos[i].upload && previous && fileWithId(previous.files, photos[i].upload.id)) || n);
        const now = this.now().toISOString();
        const opera = {
          ...fields,
          immagini: fileNames.map((n) => `./${n}`),
          ordine: previous ? previous.data.ordine : nextOrdine(opere.map((o) => o.data.ordine)),
          creataIl: previous ? previous.data.creataIl : now,
          aggiornataIl: now,
        };
        assertValid(validateOpera(opera), 'l’opera');
        result = { action: isNew ? 'create' : 'update', slug: target, opera };
        saved = fileNames;

        const changedMeanwhile = !isNew && base && previous.data.aggiornataIl !== base;
        if ((isNew && previous) || changedMeanwhile) {
          if (sameOpera(previous.data, opera)) {
            result.opera = previous.data; // exactly this was saved already: nothing to write
            return null;
          }
          // Someone saved this work after the form was opened: writing the whole form would undo it.
          if (changedMeanwhile) throw new StoreError(CHANGED_MEANWHILE_OPERA);
        }

        const keep = new Set([OPERA_FILE, ...fileNames]);
        const deletes = [...files.keys()].filter((p) => p.startsWith(dir) && !keep.has(p.slice(dir.length)));
        return {
          message: commitMessage(previous ? 'update' : 'create', opera.titolo),
          files: [
            { path: dir + OPERA_FILE, text: serializeOpera(opera) },
            ...uploadIdx.map((i, k) => ({ path: dir + fileNames[i], sha: shas[k] })),
          ],
          deletes,
        };
      },
    });
    for (const i of uploadIdx) {
      const preview = photos[i].upload.preview;
      if (preview) this.previews.set(`${OPERE_DIR}/${result.slug}/${saved[i]}`, URL.createObjectURL(preview));
    }
    return { ...result, commitSha: done.commitSha };
  }

  /** Deletes the artwork's whole folder. One commit. */
  async deleteOpera(slug, onProgress = () => {}) {
    onProgress({ phase: 'commit' });
    let titolo = slug;
    await this.gh.commit({
      prepare: async (head) => {
        const files = await this.gh.listFiles(head.treeSha);
        const dir = `${OPERE_DIR}/${slug}/`;
        const deletes = [...files.keys()].filter((p) => p.startsWith(dir));
        if (!deletes.length) return null; // already gone
        const json = files.get(dir + OPERA_FILE);
        if (json) {
          try {
            titolo = JSON.parse(await this.gh.readText(json.sha)).titolo || slug;
          } catch (err) {
            if (err instanceof GitHubError) throw err; // broken JSON: delete it anyway
          }
        }
        return { message: commitMessage('delete', titolo), files: [], deletes };
      },
    });
    return { action: 'delete', slug, titolo };
  }

  /**
   * New order: `slugs` first-to-last get ordine 10, 20, 30…; works added meanwhile on another
   * device (not in `slugs`) stay in front. Only changed files are written. One commit.
   */
  async reorder(slugs, onProgress = () => {}) {
    onProgress({ phase: 'commit' });
    let ordini = {};
    const res = await this.gh.commit({
      prepare: async (head) => {
        const files = await this.gh.listFiles(head.treeSha);
        const { opere } = await this.readOpere(files);
        const bySlug = new Map(opere.map((o) => [o.slug, o]));
        const wanted = slugs.filter((s) => bySlug.has(s));
        const others = opere.filter((o) => !wanted.includes(o.slug)).map((o) => o.slug); // already sorted
        const writes = [];
        ordini = {};
        [...others, ...wanted].forEach((s, i) => {
          const { data } = bySlug.get(s);
          const ordine = (i + 1) * 10;
          ordini[s] = ordine;
          if (data.ordine === ordine) return;
          const opera = { ...data, ordine };
          assertValid(validateOpera(opera), `«${data.titolo || s}»`);
          writes.push({ path: `${OPERE_DIR}/${s}/${OPERA_FILE}`, text: serializeOpera(opera) });
        });
        return writes.length ? { message: commitMessage('reorder'), files: writes } : null;
      },
    });
    // ordini: slug → its new `ordine`, for every work (the admin shows the new order at once)
    return { action: 'reorder', skipped: Boolean(res.skipped), ordini };
  }

  /**
   * Saves the profile. `ritratto`: null (no portrait) | { file } (keep) | { upload } (new photo).
   * `base`: `aggiornatoIl` of the version the screen was opened with.
   * The previous portrait file is deleted when it is replaced or removed. One commit.
   */
  async saveProfilo({ motto, bio, ritratto, base = null }, onProgress = () => {}) {
    const upload = ritratto && ritratto.upload;
    if (upload && !upload.id) upload.id = randomId(6);
    const uploadName = upload ? portraitFileName(upload.id) : null; // same name on every attempt
    const [uploadSha] = upload ? await this.uploadPhotos([upload], onProgress) : [];

    onProgress({ phase: 'commit' });
    let saved = null;
    const done = await this.gh.commit({
      prepare: async (head) => {
        const files = await this.gh.listFiles(head.treeSha);
        const previous = await this.readProfilo(files);
        const name = uploadName || (ritratto && ritratto.file) || null;
        if (ritratto && ritratto.file && !files.has(`${PROFILO_DIR}/${ritratto.file}`)) {
          throw new StoreError('Il ritratto non esiste più: aggiungilo di nuovo.');
        }
        const profilo = { motto, bio, ritratto: name ? `./${name}` : null, aggiornatoIl: this.now().toISOString() };
        assertValid(validateProfilo(profilo), 'il profilo');
        saved = profilo;
        if (base && previous && previous.data.aggiornatoIl !== base) {
          if (sameProfilo(previous.data, profilo)) {
            saved = previous.data; // an earlier attempt saved exactly this
            return null;
          }
          throw new StoreError(CHANGED_MEANWHILE_PROFILO);
        }
        const writes = [{ path: `${PROFILO_DIR}/${PROFILO_FILE}`, text: serializeProfilo(profilo) }];
        if (uploadSha) writes.push({ path: `${PROFILO_DIR}/${uploadName}`, sha: uploadSha });
        const old = previous && imageRefName(previous.data.ritratto);
        const deletes = old && old !== name && files.has(`${PROFILO_DIR}/${old}`) ? [`${PROFILO_DIR}/${old}`] : [];
        return { message: commitMessage('profilo'), files: writes, deletes };
      },
    });
    if (upload && upload.preview) this.previews.set(`${PROFILO_DIR}/${uploadName}`, URL.createObjectURL(upload.preview));
    return { action: 'profilo', profilo: saved, commitSha: done.commitSha };
  }

  /* ---------- publishing ---------- */

  /** Latest publish of the site: { state, url, createdAt } or null. */
  async deployStatus() {
    const run = await this.gh.latestRun(WORKFLOW_FILE);
    return run ? { state: runState(run), url: run.html_url || null, createdAt: run.created_at || null } : null;
  }
}
