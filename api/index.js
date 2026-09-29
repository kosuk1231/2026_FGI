/**
 * FGI 모집·승낙 현황 API (Vercel 서버 함수)
 * 구글 서비스 계정으로 스프레드시트에 직접 읽고 씁니다. (Apps Script 불필요)
 *
 * Vercel 환경변수
 *   GOOGLE_SERVICE_ACCOUNT_KEY : 서비스 계정 키 JSON 전체 (필수)
 *   ADMIN_PW                   : 관리자 비밀번호 (필수)
 *   SHEET_ID                   : 스프레드시트 ID (생략 시 아래 기본값)
 */
const { JWT } = require('google-auth-library');
const crypto = require('crypto');

const SHEET_ID = process.env.SHEET_ID || '1FEsoCfklBheT7CakQOAUvP25b3RN59O1EboC-efn3Io';
const SH_PEOPLE = '참여자', SH_SLOTS = '일정', SH_LOG = '로그';
const GROUPS = ['최고관리자', '중간관리자', '실무자'];
const STATUSES = ['후보', '요청함', '승낙', '보류', '불참', '확정', '취소'];
const COLS = [
  'ID', '토큰', '그룹', '성명', '소속기관', '직위', '근무지역', '시설규모',
  '연락처', '이메일', '추천인', '메모', '상태', '경로',
  '등록일시', '요청일시', '응답일시', '수정일시',
  '가능시간', '불참사유',
  '생년월', '성별', '주요업무', '현기관근무기간', '사회복지경력', '학력', '자격증',
  '동의_설명확인', '동의_자발참여', '동의_개인정보', '동의_녹음'
];
const SLOT_COLS = ['슬롯ID', '일자', '시간', '진행자', '배정그룹', '비고'];
const DEFAULT_SLOTS = [
  ['S1', '10월 6일(화)', '10:00~12:00', '김아래미(조소연)', '', ''],
  ['S2', '10월 6일(화)', '14:00~16:00', '조소연', '', ''],
  ['S3', '10월 6일(화)', '16:00~18:00', '조소연', '', ''],
  ['S4', '10월 7일(수)', '13:00~15:00', '김아래미', '', '1~3시로 변경']
];

/* ───────── 구글 시트 연결 ───────── */
let _jwt = null, _ready = false;
function jwt() {
  if (_jwt) return _jwt;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Vercel 환경변수 GOOGLE_SERVICE_ACCOUNT_KEY가 설정되지 않았습니다.');
  let key;
  try { key = JSON.parse(raw); } catch (e) { throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY가 올바른 JSON이 아닙니다. 키 파일 내용을 통째로 붙여넣어 주세요.'); }
  _jwt = new JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return _jwt;
}
async function gs(path, opt = {}) {
  const { token } = await jwt().getAccessToken();
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}${path}`, {
    method: opt.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
    if (r.status === 403 || r.status === 404) throw new Error(`스프레드시트에 접근할 수 없습니다. 시트를 서비스 계정 이메일에 '편집자'로 공유했는지 확인해 주세요. (${msg})`);
    throw new Error('구글 시트 오류: ' + msg);
  }
  return j;
}
const q = name => encodeURIComponent(`'${name}'`);
const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const now = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19); // 한국시간

async function ensureSheets() {
  if (_ready) return;
  const meta = await gs('?fields=sheets.properties.title');
  const have = (meta.sheets || []).map(s => s.properties.title);
  const need = [SH_PEOPLE, SH_SLOTS, SH_LOG].filter(n => !have.includes(n));
  if (need.length) {
    await gs(':batchUpdate', { method: 'POST', body: { requests: need.map(title => ({ addSheet: { properties: { title } } })) } });
    const data = [];
    if (need.includes(SH_PEOPLE)) data.push({ range: `'${SH_PEOPLE}'!A1`, values: [COLS] });
    if (need.includes(SH_SLOTS)) data.push({ range: `'${SH_SLOTS}'!A1`, values: [SLOT_COLS, ...DEFAULT_SLOTS] });
    if (need.includes(SH_LOG)) data.push({ range: `'${SH_LOG}'!A1`, values: [['일시', '구분', 'ID', '내용']] });
    await gs('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
  }
  _ready = true;
}
async function readRows(name) {
  const j = await gs(`/values/${q(name)}!A1:AZ`);
  return j.values || [];
}
async function readPeople() {
  const rows = await readRows(SH_PEOPLE);
  const head = rows[0] || COLS;
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i] || !rows[i][0]) continue;
    const o = { _row: i + 1 };
    head.forEach((h, j) => { o[h] = rows[i][j] ?? ''; });
    list.push(o);
  }
  return { head, list };
}
async function readSlots() {
  const rows = await readRows(SH_SLOTS);
  return rows.slice(1).filter(r => r && r[0]).map((r, i) => ({
    _row: i + 2, id: String(r[0]), date: r[1] || '', time: r[2] || '', moderator: r[3] || '', group: r[4] || '', note: r[5] || ''
  }));
}
const cleanSlots = s => s.map(({ _row, ...rest }) => rest);
const cleanPerson = ({ _row, ...rest }) => rest;

function fieldData(head, row, fields) {
  return Object.keys(fields).filter(k => head.indexOf(k) >= 0 && fields[k] !== undefined)
    .map(k => ({ range: `'${SH_PEOPLE}'!${colLetter(head.indexOf(k) + 1)}${row}`, values: [[String(fields[k])]] }));
}
async function writeFields(head, row, fields) {
  const data = fieldData(head, row, fields);
  if (data.length) await gs('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
}
async function appendRow(name, values) {
  await gs(`/values/${q(name)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: { values: [values] } });
}
const log = (type, id, msg) => appendRow(SH_LOG, [now(), type, id, msg]).catch(() => {});

/* ───────── 유틸 ───────── */
const token = () => crypto.randomBytes(9).toString('hex');
const normPhone = p => String(p || '').replace(/[^0-9]/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
function nextId(list) {
  const n = list.reduce((m, p) => Math.max(m, Number(String(p['ID']).replace(/\D/g, '')) || 0), 0) + 1;
  return 'P' + String(n).padStart(3, '0');
}
function infoFields(info = {}) {
  const o = {
    '생년월': info.birth || '', '성별': info.gender || '', '주요업무': info.duty || '',
    '현기관근무기간': info.tenure || '', '사회복지경력': info.career || '', '학력': info.edu || '', '자격증': info.license || ''
  };
  if (info.org) o['소속기관'] = info.org;
  if (info.position) o['직위'] = info.position;
  if (info.region) o['근무지역'] = info.region;
  return o;
}
const consentFields = (c = {}) => ({ '동의_설명확인': c.c1 ? 'Y' : 'N', '동의_자발참여': c.c2 ? 'Y' : 'N', '동의_개인정보': c.c3 ? 'Y' : 'N', '동의_녹음': c.c4 ? 'Y' : 'N' });
function requireConsents(c) { if (!c || !c.c1 || !c.c2 || !c.c3 || !c.c4) throw new Error('연구참여 동의 항목에 모두 동의해 주셔야 참여하실 수 있습니다.'); }
function auth(b) {
  const pw = process.env.ADMIN_PW;
  if (!pw) throw new Error('Vercel 환경변수 ADMIN_PW가 설정되지 않았습니다.');
  if (!b.pw || b.pw !== pw) throw new Error('관리자 비밀번호가 올바르지 않습니다.');
}

/* ───────── 동작 ───────── */
async function getInvite(t) {
  if (!t) throw new Error('초대 링크가 올바르지 않습니다.');
  const [{ list }, slots] = await Promise.all([readPeople(), readSlots()]);
  const p = list.find(x => x['토큰'] === t);
  if (!p) throw new Error('초대 정보를 찾을 수 없습니다. 담당자에게 문의해 주세요.');
  return {
    ok: true,
    invite: { name: p['성명'], group: p['그룹'], org: p['소속기관'], position: p['직위'], region: p['근무지역'], status: p['상태'],
      slots: String(p['가능시간'] || '').split(',').filter(Boolean), responded: !!p['응답일시'] },
    slots: cleanSlots(slots)
  };
}
async function respond(b) {
  const { head, list } = await readPeople();
  const p = list.find(x => x['토큰'] === b.t);
  if (!p) throw new Error('초대 정보를 찾을 수 없습니다.');
  const f = {};
  if (b.decision === 'accept') {
    requireConsents(b.consents);
    if (!b.slots || !b.slots.length) throw new Error('참석 가능한 시간을 1개 이상 선택해 주세요.');
    Object.assign(f, infoFields(b.info), consentFields(b.consents));
    f['가능시간'] = b.slots.join(','); f['불참사유'] = '';
    f['상태'] = p['상태'] === '확정' ? '확정' : '승낙';
  } else {
    f['상태'] = '불참'; f['불참사유'] = String(b.reason || '').slice(0, 300);
  }
  f['응답일시'] = now(); f['수정일시'] = now();
  await writeFields(head, p._row, f);
  log('응답', p['ID'], f['상태']);
  return { ok: true, status: f['상태'] };
}
async function apply(b) {
  if (!GROUPS.includes(b.group)) throw new Error('그룹 정보가 올바르지 않습니다.');
  if (!b.name || !b.phone) throw new Error('성명과 연락처는 필수입니다.');
  requireConsents(b.consents);
  if (!b.slots || !b.slots.length) throw new Error('참석 가능한 시간을 1개 이상 선택해 주세요.');
  const { head, list } = await readPeople();
  const phone = normPhone(b.phone);
  const f = Object.assign({
    '성명': b.name, '소속기관': b.org || '', '직위': b.position || '', '근무지역': b.region || '', '시설규모': b.size || '',
    '연락처': phone, '이메일': b.email || '', '가능시간': b.slots.join(','), '상태': '승낙', '응답일시': now(), '수정일시': now()
  }, infoFields(b.info), consentFields(b.consents));
  const dup = list.find(p => normPhone(p['연락처']) === phone && p['그룹'] === b.group);
  if (dup) { await writeFields(head, dup._row, f); log('공개신청(갱신)', dup['ID'], b.name); return { ok: true, updated: true }; }
  const id = nextId(list);
  const row = Object.assign({ 'ID': id, '토큰': token(), '그룹': b.group, '경로': '공개신청', '등록일시': now() }, f);
  await appendRow(SH_PEOPLE, head.map(h => row[h] ?? ''));
  log('공개신청', id, b.name);
  return { ok: true };
}
async function adminList() {
  const [{ list }, slots] = await Promise.all([readPeople(), readSlots()]);
  return { ok: true, people: list.map(cleanPerson), slots: cleanSlots(slots), serverTime: new Date().toISOString() };
}
async function adminAdd(c) {
  if (!c || !c.name) throw new Error('성명은 필수입니다.');
  if (!GROUPS.includes(c.group)) throw new Error('그룹을 선택해 주세요.');
  const { head, list } = await readPeople();
  const id = nextId(list), tk = token();
  const row = {
    'ID': id, '토큰': tk, '그룹': c.group, '성명': c.name, '소속기관': c.org || '', '직위': c.position || '',
    '근무지역': c.region || '', '시설규모': c.size || '', '연락처': normPhone(c.phone), '이메일': c.email || '',
    '추천인': c.recommender || '', '메모': c.memo || '', '상태': '후보', '경로': '초대', '등록일시': now(), '수정일시': now()
  };
  await appendRow(SH_PEOPLE, head.map(h => row[h] ?? ''));
  log('후보등록', id, c.name);
  return { ok: true, id, token: tk };
}
const EDITABLE = ['그룹', '성명', '소속기관', '직위', '근무지역', '시설규모', '연락처', '이메일', '추천인', '메모', '상태', '가능시간'];
function buildUpdate(p, fields = {}) {
  const f = {};
  Object.keys(fields).forEach(k => { if (EDITABLE.includes(k)) f[k] = fields[k]; });
  if (f['상태'] && !STATUSES.includes(f['상태'])) throw new Error('상태 값이 올바르지 않습니다.');
  if (f['상태'] === '요청함' && !p['요청일시']) f['요청일시'] = now();
  if (f['연락처']) f['연락처'] = normPhone(f['연락처']);
  if (f['가능시간'] !== undefined) {
    const v = Array.isArray(f['가능시간']) ? f['가능시간'] : String(f['가능시간']).split(',');
    f['가능시간'] = v.map(x => String(x).trim()).filter(x => /^[A-Za-z0-9_-]+$/.test(x)).join(',');
  }
  f['수정일시'] = now();
  return f;
}
async function adminUpdate(id, fields = {}) {
  const { head, list } = await readPeople();
  const p = list.find(x => x['ID'] === id);
  if (!p) throw new Error('대상을 찾을 수 없습니다.');
  const f = buildUpdate(p, fields);
  await writeFields(head, p._row, f);
  log('수정', id, JSON.stringify(f));
  return { ok: true };
}
// 여러 명을 한 번에 수정 (시간표에서 명단 선택 등)
async function adminBulk(updates = []) {
  if (!Array.isArray(updates) || !updates.length) return { ok: true, count: 0 };
  if (updates.length > 100) throw new Error('한 번에 100명까지 수정할 수 있습니다.');
  const { head, list } = await readPeople();
  const data = [];
  updates.forEach(u => {
    const p = list.find(x => x['ID'] === u.id);
    if (!p) throw new Error(`대상을 찾을 수 없습니다: ${u.id}`);
    data.push(...fieldData(head, p._row, buildUpdate(p, u.fields)));
  });
  if (data.length) await gs('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
  log('일괄수정', updates.map(u => u.id).join(','), JSON.stringify(updates.map(u => u.fields)));
  return { ok: true, count: updates.length };
}
async function adminAssign(slotId, group) {
  const slots = await readSlots();
  const data = [];
  slots.forEach(s => {
    if (group && s.group === group && s.id !== slotId) { data.push({ range: `'${SH_SLOTS}'!E${s._row}`, values: [['']] }); s.group = ''; }
    if (s.id === slotId) { data.push({ range: `'${SH_SLOTS}'!E${s._row}`, values: [[group || '']] }); s.group = group || ''; }
  });
  if (data.length) await gs('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
  log('일정배정', slotId, group || '(해제)');
  return { ok: true, slots: cleanSlots(slots) };
}

/* ───────── 진입점 ───────── */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let out;
    if (req.method === 'GET') {
      const a = (req.query || {}).action;
      if (a === 'ping') out = { ok: true, msg: 'FGI 모집 API 동작 중' };
      else {
        await ensureSheets();
        if (a === 'invite') out = await getInvite(req.query.t);
        else if (a === 'slots') out = { ok: true, slots: cleanSlots(await readSlots()) };
        else out = { ok: true, msg: 'FGI 모집 API 동작 중' };
      }
    } else if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { throw new Error('요청 형식이 올바르지 않습니다.'); } }
      b = b || {};
      await ensureSheets();
      switch (b.action) {
        case 'respond': out = await respond(b); break;
        case 'apply': out = await apply(b); break;
        case 'admin_list': auth(b); out = await adminList(); break;
        case 'admin_add': auth(b); out = await adminAdd(b.candidate); break;
        case 'admin_update': auth(b); out = await adminUpdate(b.id, b.fields); break;
        case 'admin_assign': auth(b); out = await adminAssign(b.slotId, b.group); break;
        case 'admin_bulk': auth(b); out = await adminBulk(b.updates); break;
        default: throw new Error('알 수 없는 요청입니다.');
      }
    } else { res.status(405).json({ ok: false, error: '허용되지 않는 방식입니다.' }); return; }
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
