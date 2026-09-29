import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, StatusBar, ScrollView,
} from 'react-native';
import RNFS from 'react-native-fs';
import * as DocumentPicker from 'expo-document-picker';
import { initLlama } from 'llama.rn';
import DeviceInfo from 'react-native-device-info';

const DIR = RNFS.DocumentDirectoryPath + '/models';
const CHAT = RNFS.DocumentDirectoryPath + '/chat.json';
const STOP = ['</s>', '<|end|>', '<|im_end|>', '<|eot_id|>', '<end_of_turn>', '<|endoftext|>'];
const strip = (u) => decodeURI(u.replace('file://', ''));
const HF = 'https://huggingface.co/';

// ram = أقل رام (GB) مقترح، gb = حجم الملف، rank = الجودة (الأعلى أفضل)
const REQ = {
  'Qwen2.5 0.5B': { ram: 2.5, gb: 0.4, rank: 1 },
  'TinyLlama 1.1B': { ram: 2.5, gb: 0.7, rank: 2 },
  'Llama 3.2 1B': { ram: 3, gb: 0.8, rank: 3 },
  'SmolLM2 1.7B': { ram: 3.5, gb: 1.1, rank: 4 },
  'Qwen2.5 1.5B': { ram: 3.5, gb: 1.1, rank: 5 },
  'DeepSeek R1 1.5B': { ram: 3.5, gb: 1.1, rank: 5 },
  'Gemma 2 2B': { ram: 4.5, gb: 1.6, rank: 6 },
  'Llama 3.2 3B': { ram: 5.5, gb: 2.0, rank: 7 },
  'Qwen2.5 3B': { ram: 5.5, gb: 2.1, rank: 8 },
  'Phi-3.5 mini': { ram: 7.5, gb: 2.4, rank: 9 },
};

const MODELS = [
  { name: 'Qwen2.5 0.5B', size: '~0.4 GB', note: 'خفيف وسريع', url: HF + 'Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf' },
  { name: 'Qwen2.5 1.5B', size: '~1.1 GB', note: 'متوازن، ممتاز بالعربي', url: HF + 'Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf' },
  { name: 'Qwen2.5 3B', size: '~2.1 GB', note: 'أقوى، يحتاج رام 6GB+', url: HF + 'Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf' },
  { name: 'Llama 3.2 1B', size: '~0.8 GB', note: 'من Meta، خفيف', url: HF + 'bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf' },
  { name: 'Llama 3.2 3B', size: '~2.0 GB', note: 'من Meta، قوي', url: HF + 'bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf' },
  { name: 'Gemma 2 2B', size: '~1.6 GB', note: 'من Google', url: HF + 'bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf' },
  { name: 'Phi-3.5 mini', size: '~2.4 GB', note: 'من Microsoft، منطق ممتاز', url: HF + 'bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf' },
  { name: 'SmolLM2 1.7B', size: '~1.1 GB', note: 'صغير وذكي', url: HF + 'bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf' },
  { name: 'DeepSeek R1 1.5B', size: '~1.1 GB', note: 'تفكير خطوة بخطوة', url: HF + 'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf' },
  { name: 'TinyLlama 1.1B', size: '~0.7 GB', note: 'قديم بس خفيف', url: HF + 'TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf' },
].map((m) => ({ ...m, ...REQ[m.name], file: m.url.split('/').pop() }));

export default function App() {
  const [tab, setTab] = useState('chat');
  const [have, setHave] = useState([]);
  const [prog, setProg] = useState({});
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [atts, setAtts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const ctxRef = useRef(null);
  const jobs = useRef({});
  const listRef = useRef(null);
  const [dev, setDev] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const ram = (await DeviceInfo.getTotalMemory()) / 1e9;
        const disk = (await DeviceInfo.getFreeDiskStorage()) / 1e9;
        const abis = await DeviceInfo.supportedAbis();
        const name = await DeviceInfo.getModel();
        setDev({ ram, disk, name, arm: abis.some((a) => /arm64/.test(a)) });
      } catch (e) {}
    })();
  }, []);

  const fits = (m) => (dev ? dev.ram >= m.ram && dev.disk > m.gb * 1.3 : true);
  const best = dev ? [...MODELS].filter(fits).sort((a, b) => b.rank - a.rank)[0] : null;

  const refresh = useCallback(async () => {
    try {
      await RNFS.mkdir(DIR);
      const items = await RNFS.readDir(DIR);
      setHave(items.filter((i) => /\.gguf$/i.test(i.name)).map((i) => ({ name: i.name, size: i.size })));
    } catch (e) {}
  }, []);

  useEffect(() => {
    refresh();
    RNFS.exists(CHAT).then(async (ok) => {
      if (ok) { try { setMessages(JSON.parse(await RNFS.readFile(CHAT, 'utf8'))); } catch (e) {} }
    });
  }, [refresh]);

  useEffect(() => {
    if (!busy) RNFS.writeFile(CHAT, JSON.stringify(messages.slice(-60)), 'utf8').catch(() => {});
  }, [messages, busy]);

  const startDownload = async (url, fileArg) => {
    const file = fileArg || url.split('/').pop().split('?')[0];
    if (!/\.gguf$/i.test(file)) return Alert.alert('الرابط لازم ينتهي بـ .gguf');
    await RNFS.mkdir(DIR);
    const dest = `${DIR}/${file}`;
    if (await RNFS.exists(dest)) return Alert.alert('النموذج منزّل من قبل');
    const tmp = dest + '.part';
    if (await RNFS.exists(tmp)) await RNFS.unlink(tmp);
    setProg((p) => ({ ...p, [file]: 0 }));
    const job = RNFS.downloadFile({
      fromUrl: url, toFile: tmp, progressInterval: 700,
      progress: (r) => setProg((p) => ({ ...p, [file]: r.bytesWritten / (r.contentLength || 1) })),
    });
    jobs.current[file] = job.jobId;
    try {
      const res = await job.promise;
      if (res.statusCode === 200) await RNFS.moveFile(tmp, dest);
      else { await RNFS.unlink(tmp).catch(() => {}); Alert.alert('فشل التنزيل', 'كود ' + res.statusCode); }
    } catch (e) {
      await RNFS.unlink(tmp).catch(() => {});
      Alert.alert('توقف التنزيل', String(e.message || e));
    }
    setProg((p) => { const n = { ...p }; delete n[file]; return n; });
    refresh();
  };

  const cancelDownload = (file) => { if (jobs.current[file] != null) RNFS.stopDownload(jobs.current[file]); };

  const removeModel = (file) =>
    Alert.alert('حذف النموذج', file, [
      { text: 'إلغاء' },
      { text: 'حذف', style: 'destructive', onPress: async () => {
        if (active === file && ctxRef.current) { await ctxRef.current.release(); ctxRef.current = null; setActive(null); }
        await RNFS.unlink(`${DIR}/${file}`).catch(() => {}); refresh();
      } },
    ]);

  const loadModel = async (file) => {
    setLoading(true);
    try {
      if (ctxRef.current) { await ctxRef.current.release(); ctxRef.current = null; }
      ctxRef.current = await initLlama({ model: `${DIR}/${file}`, n_ctx: dev && dev.ram < 4 ? 2048 : 4096, n_gpu_layers: 0, use_mlock: false });
      setActive(file); setTab('chat');
    } catch (e) {
      Alert.alert('تعذر تشغيل النموذج', String(e.message || e));
    }
    setLoading(false);
  };

  const importModel = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (r.canceled) return;
    const f = r.assets[0];
    if (!/\.gguf$/i.test(f.name)) return Alert.alert('الملف لازم يكون .gguf');
    setImporting(true);
    try { await RNFS.mkdir(DIR); await RNFS.copyFile(f.uri, `${DIR}/${f.name}`); }
    catch (e) { Alert.alert('فشل الاستيراد', String(e.message || e)); }
    setImporting(false); refresh();
  };

  const attach = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    const out = [];
    for (const f of r.assets) {
      try {
        const t = await RNFS.readFile(strip(f.uri), 'utf8');
        if (t.includes('\u0000')) throw new Error('binary');
        out.push({ name: f.name, text: t.slice(0, 6000) });
      } catch (e) {
        Alert.alert('ملف غير مدعوم', f.name + '\nالنماذج النصية تقرأ الملفات النصية فقط (txt, md, csv, json, كود...)');
      }
    }
    setAtts((a) => [...a, ...out]);
  };

  const send = async () => {
    if (!ctxRef.current) return Alert.alert('اختر نموذج أولاً', 'روح لتبويب النماذج ونزّل أو شغّل نموذج.');
    if (busy || (!input.trim() && !atts.length)) return;
    let content = input.trim();
    if (atts.length) content = atts.map((a) => `[ملف: ${a.name}]\n${a.text}`).join('\n\n') + '\n\n' + content;
    const userMsg = { role: 'user', content, shown: input.trim(), files: atts.map((a) => a.name) };
    const history = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput(''); setAtts([]); setBusy(true);
    let out = '';
    const put = (t) => setMessages((p) => { const c = [...p]; c[c.length - 1] = { role: 'assistant', content: t }; return c; });
    try {
      await ctxRef.current.completion(
        {
          messages: [
            { role: 'system', content: 'You are Crown, a helpful assistant. Reply in the same language as the user.' },
            ...history.slice(-12).map(({ role, content: c }) => ({ role, content: c })),
          ],
          n_predict: 768, temperature: 0.7, stop: STOP,
        },
        (d) => { out += d.token; put(out); },
      );
    } catch (e) { put(out + '\n[خطأ: ' + (e.message || e) + ']'); }
    setBusy(false);
  };

  const stop = () => ctxRef.current && ctxRef.current.stopCompletion();
  const clearChat = () => { setMessages([]); RNFS.unlink(CHAT).catch(() => {}); };

  const renderMsg = ({ item }) => {
    const me = item.role === 'user';
    return (
      <View style={[s.bubble, me ? s.me : s.bot]}>
        {me && item.files && item.files.length > 0 && <Text style={s.fileTag}>📎 {item.files.join(', ')}</Text>}
        <Text style={s.msgText} selectable>{me ? item.shown : item.content || '…'}</Text>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={s.header}>
        <Text style={s.logo}>👑 Crown <Text style={{ color: BLUE }}>Local</Text></Text>
        <Text style={s.sub}>{loading ? 'جاري تشغيل النموذج...' : active ? active : 'لا يوجد نموذج مفعّل'}</Text>
      </View>

      {tab === 'chat' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            ref={listRef} data={messages} renderItem={renderMsg} keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ padding: 14 }}
            onContentSizeChange={() => listRef.current && listRef.current.scrollToEnd({ animated: true })}
            ListEmptyComponent={<Text style={s.empty}>ابدأ محادثة، كله يشتغل على جهازك بدون نت 🔒</Text>}
          />
          {atts.length > 0 && (
            <ScrollView horizontal style={{ maxHeight: 40, paddingHorizontal: 10 }}>
              {atts.map((a, i) => (
                <TouchableOpacity key={i} style={s.chip} onPress={() => setAtts((x) => x.filter((_, j) => j !== i))}>
                  <Text style={s.chipText}>📎 {a.name}  ✕</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <View style={s.inputRow}>
            <TouchableOpacity style={s.iconBtn} onPress={attach}><Text style={s.icon}>📎</Text></TouchableOpacity>
            <TextInput style={s.input} value={input} onChangeText={setInput} placeholder="اكتب رسالتك..." placeholderTextColor="#4a5a7a" multiline />
            {busy
              ? <TouchableOpacity style={[s.iconBtn, s.send]} onPress={stop}><Text style={s.icon}>■</Text></TouchableOpacity>
              : <TouchableOpacity style={[s.iconBtn, s.send]} onPress={send}><Text style={s.icon}>➤</Text></TouchableOpacity>}
          </View>
        </KeyboardAvoidingView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14 }}>
          {dev && (
            <View style={[s.card, { borderColor: BLUE }]}>
              <Text style={s.cardTitle}>📱 {dev.name}</Text>
              <Text style={s.cardSub}>الرام {dev.ram.toFixed(1)} GB • المساحة الفاضية {dev.disk.toFixed(1)} GB</Text>
              {!dev.arm && <Text style={{ color: '#ff6b6b', marginTop: 6 }}>⚠️ المعالج مش ARM64، النماذج ممكن ما تشتغل</Text>}
              {best ? (
                <View>
                  <Text style={[s.cardTitle, { marginTop: 8 }]}>الأنسب لجهازك: {best.name}</Text>
                  <TouchableOpacity
                    style={s.btn}
                    disabled={have.some((h) => h.name === best.file) || prog[best.file] !== undefined}
                    onPress={() => startDownload(best.url, best.file)}>
                    <Text style={s.btnText}>{have.some((h) => h.name === best.file) ? 'منزّل ✓' : 'نزّل الأنسب تلقائياً'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={{ color: '#ff6b6b', marginTop: 8 }}>الرام أو المساحة ما بتكفي لأي نموذج. فضّي مساحة وجرّب.</Text>
              )}
            </View>
          )}

          <Text style={s.h}>نماذجي (على الجهاز)</Text>
          {have.length === 0 && <Text style={s.empty}>ما في نماذج بعد. نزّل واحد من تحت.</Text>}
          {have.map((m) => (
            <View key={m.name} style={[s.card, active === m.name && s.cardOn]}>
              <Text style={s.cardTitle}>{m.name}</Text>
              <Text style={s.cardSub}>{(m.size / 1e9).toFixed(2)} GB</Text>
              <View style={s.row}>
                <TouchableOpacity style={s.btn} onPress={() => loadModel(m.name)} disabled={loading}>
                  <Text style={s.btnText}>{active === m.name ? 'مفعّل ✓' : 'تشغيل'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnDark]} onPress={() => removeModel(m.name)}><Text style={s.btnText}>حذف</Text></TouchableOpacity>
              </View>
            </View>
          ))}
          {loading && <ActivityIndicator color={BLUE} style={{ margin: 10 }} />}

          <Text style={s.h}>استيراد من الجوال</Text>
          <TouchableOpacity style={s.btn} onPress={importModel} disabled={importing}>
            <Text style={s.btnText}>{importing ? 'جاري النسخ...' : 'اختر ملف .gguf'}</Text>
          </TouchableOpacity>

          <Text style={s.h}>تنزيل نموذج</Text>
          {MODELS.map((m) => {
            const p = prog[m.file]; const done = have.some((h) => h.name === m.file);
            return (
              <View key={m.file} style={s.card}>
                <Text style={s.cardTitle}>{m.name} <Text style={s.cardSub}>{m.size}</Text></Text>
                <Text style={s.cardSub}>{m.note}</Text>
                {dev && <Text style={{ color: fits(m) ? '#3ddc84' : '#ff9f43', fontSize: 12, marginTop: 4 }}>{fits(m) ? '✅ مناسب لجهازك' : '⚠️ ثقيل على جهازك'}</Text>}
                {p !== undefined ? (
                  <View>
                    <View style={s.bar}><View style={[s.barFill, { width: `${Math.round(p * 100)}%` }]} /></View>
                    <TouchableOpacity onPress={() => cancelDownload(m.file)}><Text style={s.cancel}>{Math.round(p * 100)}%  إلغاء</Text></TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={[s.btn, done && s.btnDark]} disabled={done} onPress={() => startDownload(m.url, m.file)}>
                    <Text style={s.btnText}>{done ? 'منزّل ✓' : 'تنزيل'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          <Text style={s.h}>رابط مخصص (Hugging Face)</Text>
          <TextInput style={[s.input, { maxHeight: 60 }]} value={custom} onChangeText={setCustom} placeholder="https://huggingface.co/.../resolve/main/model.gguf" placeholderTextColor="#4a5a7a" autoCapitalize="none" />
          <TouchableOpacity style={[s.btn, { marginTop: 8 }]} onPress={() => custom.trim() && startDownload(custom.trim())}>
            <Text style={s.btnText}>تنزيل الرابط</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <View style={s.tabs}>
        <TouchableOpacity style={s.tab} onPress={() => setTab('chat')}><Text style={[s.tabText, tab === 'chat' && s.tabOn]}>💬 المحادثة</Text></TouchableOpacity>
        <TouchableOpacity style={s.tab} onPress={() => setTab('models')}><Text style={[s.tabText, tab === 'models' && s.tabOn]}>🧠 النماذج</Text></TouchableOpacity>
        <TouchableOpacity style={s.tab} onPress={clearChat}><Text style={s.tabText}>🗑 مسح</Text></TouchableOpacity>
      </View>
    </View>
  );
}

const BLUE = '#1e6bff';
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { paddingTop: 44, paddingBottom: 12, paddingHorizontal: 16, backgroundColor: '#050914', borderBottomWidth: 1, borderBottomColor: '#0e2a66' },
  logo: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  sub: { color: '#5b8cff', fontSize: 12, marginTop: 2 },
  bubble: { maxWidth: '86%', padding: 12, borderRadius: 16, marginBottom: 10 },
  me: { alignSelf: 'flex-end', backgroundColor: BLUE, borderBottomRightRadius: 4 },
  bot: { alignSelf: 'flex-start', backgroundColor: '#0a1226', borderWidth: 1, borderColor: '#12306f', borderBottomLeftRadius: 4 },
  msgText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  fileTag: { color: '#cfe0ff', fontSize: 11, marginBottom: 4 },
  empty: { color: '#4a5a7a', textAlign: 'center', marginTop: 40 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, backgroundColor: '#050914', borderTopWidth: 1, borderTopColor: '#0e2a66' },
  input: { flex: 1, color: '#fff', backgroundColor: '#0a1226', borderRadius: 14, borderWidth: 1, borderColor: '#12306f', paddingHorizontal: 12, paddingVertical: 8, maxHeight: 120, marginHorizontal: 6 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a1226' },
  send: { backgroundColor: BLUE },
  icon: { color: '#fff', fontSize: 18 },
  chip: { backgroundColor: '#0a1226', borderColor: BLUE, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, justifyContent: 'center', marginRight: 6, height: 32 },
  chipText: { color: '#cfe0ff', fontSize: 12 },
  h: { color: '#fff', fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: '#070d1c', borderRadius: 14, borderWidth: 1, borderColor: '#12306f', padding: 12, marginBottom: 10 },
  cardOn: { borderColor: BLUE, shadowColor: BLUE, shadowOpacity: 0.6, shadowRadius: 10, elevation: 6 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardSub: { color: '#6f86b8', fontSize: 12, fontWeight: '400', marginTop: 2 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { backgroundColor: BLUE, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnDark: { backgroundColor: '#152447' },
  btnText: { color: '#fff', fontWeight: '700' },
  bar: { height: 8, backgroundColor: '#0e1a38', borderRadius: 4, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: BLUE },
  cancel: { color: '#5b8cff', textAlign: 'center', marginTop: 6 },
  tabs: { flexDirection: 'row', backgroundColor: '#050914', borderTopWidth: 1, borderTopColor: '#0e2a66', paddingBottom: 10 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: '#6f86b8', fontWeight: '600' },
  tabOn: { color: BLUE },
});
