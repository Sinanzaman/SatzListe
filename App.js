import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
// removed: import * as FileSystem from 'expo-file-system';
// removed: import * as DocumentPicker from 'expo-document-picker';
// removed: import * as Sharing from 'expo-sharing';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';

function MainApp() {
  const [german, setGerman] = useState('');
  const [turkish, setTurkish] = useState('');
  const [selectedWord, setSelectedWord] = useState(null); // { key, label }
  const [selectedMeaning, setSelectedMeaning] = useState('');

  // Global sözlük: daha önce girilen kelime anlamları (oturum boyunca)
  const [globalDict, setGlobalDict] = useState({}); // key(lower) -> meaning

  // Geçerli cümleye özel kelime anlamları
  const [localWordMeanings, setLocalWordMeanings] = useState({}); // key(lower) -> meaning

  // Kayıtlı Cümleler listesi
  const [sentences, setSentences] = useState([]);

  // Basit ekran yöneticisi (navigation bağımlılığı olmadan)
  const [screen, setScreen] = useState('write'); // 'write' | 'list' | 'study'
  const [studyIndex, setStudyIndex] = useState(null);
  const [studyLessonIndex, setStudyLessonIndex] = useState(null); // null: ders listesi; sayı: seçili ders
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [wordLayouts, setWordLayouts] = useState({}); // idx -> {x,y,width,height}
  const [popup, setPopup] = useState(null); // { idx, key, label, meaning, x, y }
  const [showTranslation, setShowTranslation] = useState(false);
  const [showSentence, setShowSentence] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [editingId, setEditingId] = useState(null); // mevcut kaydı Düzenleme
  // const exportJson = useMemo(
  //   () => JSON.stringify({ version: 1, sentences, dict: globalDict }, null, 2),
  //   [sentences, globalDict]
  // );
  const [search, setSearch] = useState('');
  const filteredSentences = useMemo(() => {
    const list = sentences || [];
    const q = (search || '').toLocaleLowerCase('tr');
    if (!q) return list;
    return list.filter((s) =>
      (s.german || '').toLocaleLowerCase('tr').includes(q) ||
      (s.turkish || '').toLocaleLowerCase('tr').includes(q)
    );
  }, [sentences, search]);

  // Cümleleri 10'arlı derslere böl
  const lessons = useMemo(() => {
    const list = sentences || [];
    const out = [];
    for (let i = 0; i < list.length; i += 10) {
      out.push(list.slice(i, i + 10));
    }
    return out;
  }, [sentences]);

  // Hızlı erişim için id -> index haritası
  const idToIndex = useMemo(() => {
    const m = new Map();
    (sentences || []).forEach((it, i) => m.set(it.id, i));
    return m;
  }, [sentences]);

  const STORAGE_SENTENCES = 'satzliste.sentences.v1';
  const STORAGE_DICT = 'satzliste.dict.v1';

  // Başlangıçta verileri yükle
  useEffect(() => {
    (async () => {
      try {
        const [rawSentences, rawDict] = await Promise.all([
          AsyncStorage.getItem(STORAGE_SENTENCES),
          AsyncStorage.getItem(STORAGE_DICT),
        ]);
        if (rawSentences) {
          try {
            const parsed = JSON.parse(rawSentences);
            if (Array.isArray(parsed)) setSentences(parsed);
          } catch { }
        }
        if (rawDict) {
          try {
            const parsed = JSON.parse(rawDict);
            if (parsed && typeof parsed === 'object') setGlobalDict(parsed);
          } catch { }
        }
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Değişikliklerde kalıcı kaydet
  useEffect(() => {
    if (!hydrated) return;
    try {
      AsyncStorage.setItem(STORAGE_SENTENCES, JSON.stringify(sentences));
    } catch { }
  }, [sentences, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      AsyncStorage.setItem(STORAGE_DICT, JSON.stringify(globalDict));
    } catch { }
  }, [globalDict, hydrated]);

  const handleClear = () => {
    setGerman('');
    setTurkish('');
    setLocalWordMeanings({});
    setSelectedWord(null);
    setSelectedMeaning('');
    setEditingId(null);
    setNote('');
    setShowNote(false);
  };

  // Metinden kelimeleri çıkar (benzersiz) ve görünen etiketi koru
  const words = useMemo(() => {
    const tokens = tokenize(german);
    // benzersiz yap: ilk görünen formu sakla
    const map = new Map();
    tokens.forEach((label) => {
      const key = label.toLocaleLowerCase('tr');
      if (!map.has(key)) map.set(key, label);
    });
    return Array.from(map, ([key, label]) => ({ key, label }));
  }, [german]);

  const meaningFor = (key) => {
    // Önce cümleye özel, sonra global sözlük
    return localWordMeanings[key] ?? globalDict[key] ?? '';
  };

  const openWordEditor = (word) => {
    setSelectedWord(word); // {key, label}
    setSelectedMeaning(meaningFor(word.key));
  };

  const saveSelectedMeaning = () => {
    if (!selectedWord) return;
    const key = selectedWord.key;
    const value = selectedMeaning.trim();
    setLocalWordMeanings((prev) => ({ ...prev, [key]: value }));
    if (value) setGlobalDict((prev) => ({ ...prev, [key]: value }));
  };

  const deleteSelectedMeaning = () => {
    if (!selectedWord) return;
    const key = selectedWord.key;
    setLocalWordMeanings((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setGlobalDict((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setSelectedMeaning('');
  };

  const handleSaveSentence = () => {
    if (!german.trim() || !turkish.trim()) return;
    // Cümledeki kelimelerin anlamı: yerel + eksiğini globalden tamamla
    const sentenceKeys = tokenize(german).map((w) => w.toLocaleLowerCase('tr'));
    const wordsMap = {};
    sentenceKeys.forEach((k) => {
      const val = localWordMeanings[k] ?? globalDict[k];
      if (val) wordsMap[k] = val;
    });

    if (editingId) {
      // Güncelle
      setSentences((prev) =>
        prev.map((it) =>
          it.id === editingId
            ? { ...it, german: german.trim(), turkish: turkish.trim(), words: wordsMap, note: note.trim() }
            : it
        )
      );
    } else {
      const item = {
        id: Date.now().toString(),
        german: german.trim(),
        turkish: turkish.trim(),
        words: wordsMap,
        note: note.trim(),
      };
      setSentences((prev) => [...prev, item]);
    }
    // global sözlüğü de güncelle (kolay ulaşım için)
    if (Object.keys(wordsMap).length) {
      setGlobalDict((prev) => ({ ...prev, ...wordsMap }));
    }
    // formu temizle ve listeye dön
    handleClear();
    setScreen('list');
  };

  const canSave = german.trim().length > 0 && turkish.trim().length > 0;

  // Study ekranına geçince bir cümle seç
  // Study ekranı: ders ve indeks hazırlıkları
  useEffect(() => {
    if (screen === 'study') {
      setPopup(null);
      setWordLayouts({});
      setShowTranslation(false);
      setShowSentence(false);
      setShowNote(false);
      if (studyLessonIndex !== null) {
        const current = lessons[studyLessonIndex] || [];
        if (current.length > 0) {
          setStudyIndex(Math.floor(Math.random() * current.length));
        } else {
          setStudyIndex(null);
        }
      } else {
        setStudyIndex(null);
      }
    }
  }, [screen, sentences.length, studyLessonIndex, lessons.length]);

  const refreshStudy = () => {
    const current = studyLessonIndex !== null ? (lessons[studyLessonIndex] || []) : [];
    if (current.length === 0) return;
    setPopup(null);
    setWordLayouts({});
    setStudyIndex(Math.floor(Math.random() * current.length));
    setShowTranslation(false);
    setShowSentence(false);
    setShowNote(false);
  };

  const speakCurrent = () => {
    const current = studyLessonIndex !== null ? (lessons[studyLessonIndex] || []) : [];
    if (studyIndex === null || !current[studyIndex]) return;
    const text = current[studyIndex].german?.trim();
    if (!text) return;
    try {
      Speech.stop();
      Speech.speak(text, { language: 'de-DE' });
    } catch (e) {
      // no-op
    }
  };

  /*
  const parseImported = (text) => {
    try {
      const obj = JSON.parse(text);
      const sentencesIn = obj.sentences || obj.Sentences || [];
      const dictIn = obj.dict || obj.words || obj.dictionary || {};
      if (!Array.isArray(sentencesIn) || typeof dictIn !== 'object' || dictIn === null) {
        return null;
      }
      return { sentences: sentencesIn, dict: dictIn };
    } catch {
      return null;
    }
  };

  const exportToFile = async () => {
    try {
      const filename = `satzliste-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      const path = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, exportJson, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        try {
          // Bazı cihazlarda mime/UTI verilince hata oluşabiliyor; sade çağrı daha stabil
          await Sharing.shareAsync(path);
          return;
        } catch (e) {
          // Android için SAF ile yedekleme dene
          if (Platform.OS === 'android') {
            const ok = await exportToFileAndroidSaf(filename, exportJson);
            if (ok) return;
          }
          throw e;
        }
      }
      // Paylaşım yoksa veya başarısızsa: Android SAF dene, değilse yol bilgisini ver
      if (Platform.OS === 'android') {
        const ok = await exportToFileAndroidSaf(filename, exportJson);
        if (ok) return;
      }
      Alert.alert('Hazırlandı', `Paylaşım kullanılamıyor. Dosya geçici klasöre yazıldı:\n${path}`);
    } catch (e) {
      Alert.alert('Hata', 'Dosyaya kaydetme/paylaşma sırasında sorun oluştu.');
    }
  };

  async function exportToFileAndroidSaf(filename, contents) {
    try {
      const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perms.granted) return false;
      const dirUri = perms.directoryUri;
      const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        dirUri,
        filename,
        'application/json'
      );
      await FileSystem.writeAsStringAsync(fileUri, contents, { encoding: FileSystem.EncodingType.UTF8 });
      Alert.alert('Kaydedildi', 'JSON dosyası seçtiğiniz klasöre kaydedildi.');
      return true;
    } catch (e) {
      return false;
    }
  }

  const importFromFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', multiple: false, copyToCacheDirectory: true });
      // New API returns {assets, canceled}
      if (res.canceled) return;
      const asset = res.assets && res.assets[0] ? res.assets[0] : res;
      if (!asset || !asset.uri) return;
      const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
      const data = parseImported(content);
      if (!data) {
        Alert.alert('Geçersiz veri', 'JSON formatı veya veri yapısı hatalı.');
        return;
      }
      Alert.alert('İçe Aktarma', 'Bu verileri mevcut verilerle nasıl uygulayalım?', [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Birleştir',
          onPress: () => {
            // merge
            setSentences((prev) => {
              const byId = new Set(prev.map((s) => s.id));
              const merged = [...prev];
              (data.sentences || []).forEach((s) => {
                if (s && typeof s === 'object' && s.id && !byId.has(s.id)) merged.push(s);
              });
              return merged;
            });
            setGlobalDict((prev) => ({ ...(data.dict || {}), ...prev }));
            Alert.alert('Tamamlandı', 'Veriler birleştirildi.');
          },
        },
        {
          text: 'Yerine Yaz',
          style: 'destructive',
          onPress: () => {
            setSentences(Array.isArray(data.sentences) ? data.sentences : []);
            setGlobalDict(data.dict && typeof data.dict === 'object' ? data.dict : {});
            Alert.alert('Tamamlandı', 'Veriler değiştirildi.');
          },
        },
      ]);
    } catch (e) {
      Alert.alert('Hata', 'Dosya alınamadı veya okunamadı.');
    }
  };
  */

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.select({ ios: 'padding', android: undefined })}
      >
        <View style={styles.flex}>
          {/* Basit üst bar: ekranlar arası geçiş */}
          <View style={styles.topBar}>
            <Pressable onPress={() => setScreen('write')} style={[styles.tab, screen === 'write' && styles.tabActive]}>
              <Text style={[styles.tabText, screen === 'write' && styles.tabTextActive]}>Yazma</Text>
            </Pressable>
            <Pressable onPress={() => setScreen('list')} style={[styles.tab, screen === 'list' && styles.tabActive]}>
              <Text style={[styles.tabText, screen === 'list' && styles.tabTextActive]}>Cümleler</Text>
            </Pressable>
            <Pressable onPress={() => setScreen('study')} style={[styles.tab, screen === 'study' && styles.tabActive]}>
              <Text style={[styles.tabText, screen === 'study' && styles.tabTextActive]}>Çalışma</Text>
            </Pressable>
          </View>

          {!hydrated ? (
            <View style={[styles.container]}>
              <Text style={styles.muted}>Veriler yükleniyor…</Text>
            </View>
          ) : screen === 'write' ? (
            <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>{editingId ? 'Düzenle' : 'Yazma'}</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Almanca cümle</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Örn: Ich lerne Deutsch."
                  value={german}
                  onChangeText={setGerman}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Türkçe çeviri</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Örn: Ben Almanca öğreniyorum."
                  value={turkish}
                  onChangeText={setTurkish}
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Not (isteğe bağlı)</Text>
                <TextInput
                  style={[styles.input]}
                  placeholder="Not..."
                  value={note}
                  onChangeText={setNote}
                  autoCorrect={false}
                  multiline
                  textAlignVertical="top"
                />
              </View>
              {/* Kelime çipleri */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Kelime anlamları</Text>
                <View style={styles.wordWrap}>
                  {words.length === 0 ? (
                    <Text style={styles.muted}>Kelime bulunamadı. Cümle yazmayı deneyin.</Text>
                  ) : (
                    words.map((w) => {
                      const m = meaningFor(w.key);
                      return (
                        <Pressable key={w.key} onPress={() => openWordEditor(w)} style={styles.wordChip}>
                          <Text style={styles.wordChipText}>{w.label}</Text>
                          {!!m && <Text style={styles.wordChipMeaning}>{m}</Text>}
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </View>

              {/* Kelime anlamı düzenleyici */}
              {selectedWord && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>
                    "{selectedWord.label}" kelimesi için anlam
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Türkçe anlamını yazın"
                    value={selectedMeaning}
                    onChangeText={setSelectedMeaning}
                    autoCapitalize="sentences"
                    autoCorrect={false}
                  />
                  <View style={styles.actions}>
                    <Pressable style={[styles.button, styles.secondary]} onPress={() => { setSelectedWord(null); setSelectedMeaning(''); }}>
                      <Text style={[styles.buttonText, styles.secondaryText]}>Kapat</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.danger]} onPress={deleteSelectedMeaning}>
                      <Text style={[styles.buttonText, styles.dangerText]}>Anlamı Sil</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.primary]} onPress={saveSelectedMeaning}>
                      <Text style={[styles.buttonText, styles.primaryText]}>Anlamı Kaydet</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.actions}>
                <Pressable style={[styles.button, styles.secondary]} onPress={handleClear}>
                  <Text style={[styles.buttonText, styles.secondaryText]}>{editingId ? 'İptal' : 'Temizle'}</Text>
                </Pressable>
                <Pressable disabled={!canSave} style={[styles.button, canSave ? styles.primary : styles.disabled]} onPress={handleSaveSentence}>
                  <Text style={[styles.buttonText, canSave ? styles.primaryText : styles.disabledText]}>{editingId ? 'Güncelle' : 'Kaydet'}</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            screen === 'list' ? (
              <ScrollView contentContainerStyle={styles.container}>
                <Text style={styles.title}>Cümleler</Text>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Ara</Text>
                  <TextInput
                    style={[styles.input, styles.inputSingle]}
                    placeholder="Almanca veya Türkçe..."
                    value={search}
                    onChangeText={setSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                </View>

                {(search ? filteredSentences : sentences).length === 0 ? (
                  <Text style={styles.muted}>Henüz kayıtlı cümle yok.</Text>
                ) : (
                  (search ? filteredSentences : sentences).map((s) => (
                    <View key={s.id} style={styles.card}>
                      <Text style={styles.cardGerman}>{s.german}</Text>
                      {(() => { const idx = idToIndex.get(s.id); if (typeof idx === 'number' && idx >= 0) { const lesson = Math.floor(idx / 10) + 1; return (<Text style={styles.muted}>{'Ders ' + lesson}</Text>); } return null; })()}
                      <Text style={styles.cardTurkish}>{s.turkish}</Text>
                      <View style={styles.cardActions}>
                        <Pressable
                          style={[styles.button, styles.secondary]}
                          onPress={() => {
                            setEditingId(s.id);
                            setGerman(s.german);
                            setTurkish(s.turkish);
                            setLocalWordMeanings(s.words || {});
                            setNote(s.note || '');
                            setSelectedWord(null);
                            setSelectedMeaning('');
                            setScreen('write');
                          }}
                        >
                          <Text style={[styles.buttonText, styles.secondaryText]}>Düzenle</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.button, styles.danger]}
                          onPress={() => {
                            Alert.alert(
                              'Cümleyi sil',
                              'Bu cümleyi silmek istediğinize emin misiniz? (Kelime anlamları korunacak)',
                              [
                                { text: 'Vazgeç', style: 'cancel' },
                                {
                                  text: 'Sil',
                                  style: 'destructive',
                                  onPress: () => setSentences((prev) => prev.filter((it) => it.id !== s.id)),
                                },
                              ]
                            );
                          }}
                        >
                          <Text style={[styles.buttonText, styles.dangerText]}>Sil</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            ) : (
              // study
              <View style={styles.container}>
                {lessons.length === 0 ? (
                  <Text style={styles.muted}>Çalışacak cümle bulunamadı. Önce cümle ekleyin.</Text>
                ) : (
                  studyLessonIndex === null ? (
                    <View>
                      <Text style={styles.title}>Dersler</Text>
                      <FlatList
                        data={lessons}
                        keyExtractor={(item, index) => `lesson-${index}`}
                        renderItem={({ item, index }) => (
                          <Pressable style={styles.card} onPress={() => {
                            setStudyLessonIndex(index); setShowTranslation(false); setShowSentence(false);
                            setShowNote(false);
                          }}>
                            <Text style={styles.cardGerman}>{`Ders ${index + 1}`}</Text>
                            <Text style={styles.cardTurkish}>{`Cümleler ${index * 10 + 1}-${index * 10 + item.length} • ${item.length} cümle`}</Text>
                          </Pressable>
                        )}
                        contentContainerStyle={{ gap: 12 }}
                      />
                    </View>
                  ) : (
                    <View style={{ gap: 12 }}>
                      <Text style={styles.title}>{`Ders ${(studyLessonIndex ?? 0) + 1}`}</Text>
                      <View style={styles.studyToolbar}>
                        <Pressable style={[styles.iconButton]} onPress={speakCurrent}>
                          <Text style={styles.iconText}>🔊</Text>
                        </Pressable>
                        <Pressable style={[styles.button, styles.secondary]} onPress={() => setShowSentence((v) => !v)}>
                          <Text style={[styles.buttonText, styles.secondaryText]}>{showSentence ? 'Cümleyi Gizle' : 'Cümleyi Göster'}</Text>
                        </Pressable>
                        <Pressable style={[styles.button, styles.secondary]} onPress={() => {
                          setStudyLessonIndex(null); setPopup(null); setWordLayouts({}); setShowSentence(false);
                          setShowNote(false); setShowTranslation(false);
                        }}>
                          <Text style={[styles.buttonText, styles.secondaryText]}>Derslere Dön</Text>
                        </Pressable>
                      </View>
                      <View style={styles.studyBox}>
                        {showSentence ? (
                          <View style={styles.studySentenceContainer}>
                            <Text>
                              {tokenizeWithSeparators(lessons[studyLessonIndex][studyIndex]?.german || '').map((part, idx) => {
                                if (part.type === 'sep') {
                                  // Ayırıcılar da <Text> içinde kalsın
                                  return (
                                    <Text key={`s${idx}`} style={styles.studySep}>
                                      {part.label}
                                    </Text>
                                  );
                                }
                                const key = part.label.toLocaleLowerCase('tr');
                                const meaning =
                                  (lessons[studyLessonIndex][studyIndex]?.words || {})[key] ?? globalDict[key];
                                const isKnown = !!meaning;

                                return (
                                  <Text
                                    key={`w${idx}`}
                                    onPress={() => {
                                      if (!isKnown) return;
                                      // Basit konum: sabit offset; istersen sonra hizalamayı geliştiririz
                                      setPopup({ idx, key, label: part.label, meaning, x: 12, y: 28 });
                                    }}
                                    style={[styles.studyWord, isKnown && styles.underlined]}
                                  >
                                    {part.label}
                                  </Text>
                                );
                              })}
                            </Text>

                            {popup && (
                              <Pressable onPress={() => setPopup(null)} style={[styles.popup, { left: popup.x, top: popup.y }]}>
                                <Text style={styles.popupTitle}>{popup.label}</Text>
                                <Text style={styles.popupMeaning}>{popup.meaning}</Text>
                              </Pressable>
                            )}
                          </View>
                        ) : (
                          <Text style={styles.muted}>Cümle gizli. Dinlemek için hoparlöre basın.</Text>
                        )}
                      </View>
                      {showTranslation && (
                        <View style={styles.translationBox}>
                          <Text style={styles.translationLabel}>Türkçe</Text>
                          <Text style={styles.translationText}>{lessons[studyLessonIndex][studyIndex]?.turkish}</Text>
                        </View>
                      )}
                      {(() => { const cs = (lessons[studyLessonIndex] && lessons[studyLessonIndex][studyIndex]) || null; const noteText = (cs && cs.note) ? String(cs.note).trim() : ''; if (!showNote || !noteText) return null; return (<View style={styles.translationBox}><Text style={styles.translationLabel}>Not</Text><Text style={styles.translationText}>{noteText}</Text></View>); })()}
                      <View style={styles.actionsCentered}>
                        <Pressable style={[styles.button, styles.secondary]} onPress={() => setShowTranslation((v) => !v)}>
                          <Text style={[styles.buttonText, styles.secondaryText]}>{showTranslation ? 'Çeviriyi Gizle' : 'Çeviriyi Göster'}</Text>
                        </Pressable>
                        {(() => {
                          const cs = (lessons[studyLessonIndex] && lessons[studyLessonIndex][studyIndex]) || null;
                          const noteText = (cs && cs.note) ? String(cs.note).trim() : "";
                          if (!noteText) return null;
                          return (
                            <Pressable style={[styles.button, styles.secondary]} onPress={() => setShowNote(v => !v)}>
                              <Text style={[styles.buttonText, styles.secondaryText]}>{showNote ? "Notu Gizle" : "Notu Göster"}</Text>
                            </Pressable>
                          );
                        })()}
                        <Pressable style={[styles.button, styles.primary]} onPress={refreshStudy}>
                          <Text style={[styles.buttonText, styles.primaryText]}>Başka Cümle</Text>
                        </Pressable>
                      </View>
                    </View>
                  )
                )}
              </View>
            )
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  flex: { flex: 1 },
  container: {
    padding: 16,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  inputSingle: {
    minHeight: 44,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  actionsCentered: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondary: {
    backgroundColor: '#f1f1f1',
  },
  secondaryText: {
    color: '#333',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  primary: {
    backgroundColor: '#2563eb',
  },
  primaryText: {
    color: '#fff',
  },
  disabled: {
    backgroundColor: '#e5e7eb',
  },
  disabledText: {
    color: '#9ca3af',
  },
  danger: {
    backgroundColor: '#ef4444',
  },
  dangerText: {
    color: '#fff',
  },
  topBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
  },
  tabText: {
    fontSize: 16,
    color: '#555',
  },
  tabTextActive: {
    color: '#111',
    fontWeight: '600',
  },
  wordWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordChip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f9fafb',
  },
  wordChipText: {
    fontSize: 14,
    color: '#111',
  },
  wordChipMeaning: {
    fontSize: 12,
    color: '#2563eb',
  },
  muted: {
    color: '#6b7280',
  },
  card: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 6,
  },
  cardGerman: {
    fontSize: 16,
    fontWeight: '600',
  },
  cardTurkish: {
    fontSize: 15,
    color: '#333',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  translationBox: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    gap: 6,
  },
  translationLabel: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  translationText: {
    fontSize: 16,
    color: '#111',
  },
  // Çalışma araç çubuğu ve hoparlör stili
  studyToolbar: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  iconButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 32,
  },
  studyBox: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
    position: 'relative',
    zIndex: 10,
  },
  studySentenceContainer: {
    position: 'relative',
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  studyWordWrapper: {
    marginRight: 4,
  },
  studyWord: {
    fontSize: 18,
    color: '#111',
  },
  studySep: {
    fontSize: 18,
    color: '#111',
  },
  underlined: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
  },
  popup: {
    position: 'absolute',
    maxWidth: 240,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 12,
    zIndex: 1000,
  },
  popupTitle: {
    fontSize: 14,
    fontWeight: '600',
    paddingRight: 20,
  },
  popupMeaning: {
    fontSize: 14,
    color: '#111',
  },
});

// Yardımcı: cümleyi kelimelere ayır
function tokenize(text) {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

// Yardımcı: ayırıcıları koruyarak tokenizasyon (kelime ve ayırıcılar)
function tokenizeWithSeparators(text) {
  if (!text) return [];
  const regex = /(\p{L}|\p{N})+/gu; // kelime grupları
  const out = [];
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      out.push({ type: 'sep', label: text.slice(lastIndex, m.index) });
    }
    out.push({ type: 'word', label: m[0] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push({ type: 'sep', label: text.slice(lastIndex) });
  }
  return out;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}




