// Minimal in-memory Firestore, mocking only what the app's index.html REST
// calls actually use: create-only :commit (409 on conflict), GET one doc,
// and :runQuery in its two shapes (paginated createdAt>cursor, and equality
// by cardId — plus an unfiltered listCollection scan for meta/baseline*).
//
// Deliberately never touches the network: any URL that isn't
// firestore.googleapis.com rejects, so a test can never accidentally hit
// the real backend (see the crypto-ledger "manual writes poison latest"
// lesson — this fake exists specifically so that never happens here).
//
// createTime is a monotonic counter, not wall-clock time: it needs to be
// strictly ordered by call order (matching what real Firestore's own
// server-timestamp ordering guarantees for this app's write pattern), and a
// counter makes cross-device interleaving in tests exactly reproducible.

function makeClock() {
  let n = 0;
  return () => {
    n += 1;
    // Formatted as an RFC3339 timestamp so `new Date(x)` and string
    // comparison both behave the way real Firestore timestamps do.
    const ms = 1700000000000 + n;
    return new Date(ms).toISOString();
  };
}

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v) } };
  throw new Error("fake-firestore: unsupported type " + typeof v);
}
function encodeFields(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = encodeValue(obj[k]);
  return out;
}

function decodeValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decodeValue(fields[k]);
  return out;
}

export function createFakeFirestore() {
  const docs = new Map();   // full document name -> { fields (wire), createTime }
  const nextCreateTime = makeClock();
  let failWhen = null;   // (url, opts) => boolean — see failOnce() below

  // Shared by the real :commit HTTP path and the direct test-seeding path,
  // so a seeded row is indistinguishable from one the app itself wrote.
  function createOnly(name, wireFields, transforms) {
    if (docs.has(name)) return { created: false };
    const createTime = nextCreateTime();
    const fields = { ...wireFields };
    for (const t of transforms || []) {
      if (t.setToServerValue === "REQUEST_TIME") fields[t.fieldPath] = { timestampValue: createTime };
    }
    docs.set(name, { fields, createTime });
    return { created: true, createTime };
  }

  function collectionEntries(parentPath, collectionId) {
    const prefix = `${parentPath}/${collectionId}/`;
    const out = [];
    for (const [name, doc] of docs) {
      if (!name.startsWith(prefix)) continue;
      if (name.slice(prefix.length).includes("/")) continue;   // direct children only
      out.push({ name, doc });
    }
    return out;
  }

  function runQuery(parentPath, structuredQuery) {
    const collectionId = structuredQuery.from[0].collectionId;
    let entries = collectionEntries(parentPath, collectionId);
    const where = structuredQuery.where;
    if (where?.fieldFilter) {
      const { field, op, value } = where.fieldFilter;
      const key = field.fieldPath;
      entries = entries.filter(({ doc }) => {
        const actual = doc.fields[key];
        if (op === "EQUAL") return actual && JSON.stringify(actual) === JSON.stringify(value);
        if (op === "GREATER_THAN") {
          if (!actual || !("timestampValue" in actual)) return false;
          return actual.timestampValue > value.timestampValue;
        }
        throw new Error(`fake-firestore: unsupported op ${op}`);
      });
    }
    const orderBy = structuredQuery.orderBy;
    if (orderBy?.length) {
      entries.sort((a, b) => {
        for (const ob of orderBy) {
          const key = ob.field.fieldPath;
          const av = key === "__name__" ? a.name : a.doc.fields[key]?.timestampValue;
          const bv = key === "__name__" ? b.name : b.doc.fields[key]?.timestampValue;
          if (av < bv) return -1;
          if (av > bv) return 1;
        }
        return 0;
      });
    }
    if (structuredQuery.limit) entries = entries.slice(0, structuredQuery.limit);
    return entries.map(({ name, doc }) => ({
      document: { name, fields: doc.fields, createTime: doc.createTime },
    }));
  }

  async function fetchImpl(url, opts = {}) {
    if (!url.startsWith("https://firestore.googleapis.com/")) {
      throw new Error(`fake-firestore: refusing to hit real network for ${url}`);
    }
    if (failWhen && failWhen(url, opts)) {
      failWhen = null;
      throw new Error("fake-firestore: injected failure");
    }
    // Manual string ops rather than the URL class: Firestore paths contain a
    // literal "(default)" segment, and this avoids ever wondering whether
    // that got percent-encoded/decoded on the way through.
    const path = url.split("?")[0].replace("https://firestore.googleapis.com/v1/", "");

    if (path.endsWith(":commit")) {
      const body = JSON.parse(opts.body);
      const write = body.writes[0];
      const result = createOnly(write.update.name, write.update.fields, write.updateTransforms);
      if (!result.created && write.currentDocument?.exists === false) {
        return { ok: true, status: 409, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }

    if (path.endsWith(":runQuery")) {
      const body = JSON.parse(opts.body);
      const parentPath = path.slice(0, -":runQuery".length);
      const results = runQuery(parentPath, body.structuredQuery);
      return { ok: true, status: 200, json: async () => results };
    }

    // Plain GET of a single document.
    const name = path;
    const doc = docs.get(name);
    if (!doc) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ fields: doc.fields, name, createTime: doc.createTime }) };
  }

  return {
    fetch: fetchImpl,
    // Test-only direct write, bypassing the app entirely — used to seed a
    // review/baseline row with an exact, chosen `reviewedAt` without racing
    // the app's own fire-and-forget outbox flush. Produces a row
    // indistinguishable from one the app wrote itself (same create-only +
    // REQUEST_TIME path).
    seedCreate(name, plainFields) {
      const result = createOnly(name, encodeFields(plainFields), [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }]);
      if (!result.created) throw new Error(`fake-firestore: seedCreate ${name} already exists`);
      return result;
    },
    // Makes the next fetch matching `matcher(url, opts)` throw once, then
    // reverts to normal behavior — for testing a network failure mid-sync.
    failOnce(matcher) { failWhen = matcher; },
    // Test introspection only — never used by production code paths.
    _dump() {
      const out = {};
      for (const [name, doc] of docs) out[name] = decodeFields(doc.fields);
      return out;
    },
    _docCount() { return docs.size; },
  };
}
