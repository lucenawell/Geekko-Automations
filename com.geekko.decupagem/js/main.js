/* global CSInterface */
'use strict';

const PYTHON_SCRIPTS = 'C:\\Users\\Wellington\\Desktop\\Geekko\\Automação\\Agentes\\detector_camera_estavel';

const { spawn, exec } = require('child_process');
const fs        = require('fs');
const path      = require('path');
// Funções de silêncio inline (em vez de módulo separado)

const cs = new CSInterface();

// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES INLINE: Transcrição com Whisper
// ═════════════════════════════════════════════════════════════════════════════
function transcribeAudio(audioPath, model = 'base') {
  return new Promise((resolve, reject) => {
    console.log('[transcribeAudio] INICIANDO');
    console.log('[transcribeAudio] audioPath:', audioPath);

    if (!fs.existsSync(audioPath)) {
      console.error('[transcribeAudio] ARQUIVO NÃO EXISTE:', audioPath);
      return reject(new Error(`Arquivo não encontrado: ${audioPath}`));
    }

    console.log('[transcribeAudio] ✓ Arquivo existe');

    const whisperPath = 'C:\\Users\\Wellington\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\whisper.exe';
    const outputDir = path.dirname(audioPath);

    console.log('[transcribeAudio] whisperPath:', whisperPath);
    console.log('[transcribeAudio] whisper existe?', fs.existsSync(whisperPath));
    console.log('[transcribeAudio] outputDir:', outputDir);

    const args = [
      audioPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', outputDir,
      '--task', 'transcribe',
      '--word_timestamps', 'True'  // ← Ativar timestamps por palavra
    ];

    console.log('[transcribeAudio] args:', args);
    console.log('[Whisper] Iniciando transcrição...');

    // DEBUG DETALHADO
    const whisperExists = fs.existsSync(whisperPath);
    console.log('[DEBUG] whisper.exe existe?', whisperExists);

    if (!whisperExists) {
      console.error('[DEBUG] ❌ WHISPER NÃO ENCONTRADO EM:', whisperPath);
      return reject(new Error('Whisper.exe não encontrado em: ' + whisperPath));
    }

    console.log('[DEBUG] Tentando spawn com:');
    console.log('[DEBUG] - programa:', whisperPath);
    console.log('[DEBUG] - arquivo de áudio:', audioPath);
    console.log('[DEBUG] - diretório output:', outputDir);

    let proc;
    try {
      proc = spawn(whisperPath, args);
      console.log('[DEBUG] ✓ Spawn executado, pid:', proc.pid);
    } catch(spawnErr) {
      console.error('[DEBUG] ❌ ERRO NO SPAWN:', spawnErr.message);
      return reject(new Error('Erro ao iniciar Whisper: ' + spawnErr.message));
    }

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (data.toString().includes('%')) {
        console.log('[Whisper]', data.toString().trim());
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Whisper error: ${err.message}`));
    });

    proc.on('close', (code) => {
      console.log('[Whisper] Exit code:', code);
      if (code !== 0) {
        console.error('[Whisper] stderr:', stderr);
        return reject(new Error(`Whisper retornou código ${code}`));
      }

      try {
        const baseName = path.basename(audioPath, path.extname(audioPath));
        const jsonPath = path.join(outputDir, `${baseName}.json`);

        console.log('[Whisper] Lendo JSON de:', jsonPath);
        if (!fs.existsSync(jsonPath)) {
          return reject(new Error(`JSON não criado em: ${jsonPath}`));
        }

        const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
        const result = JSON.parse(jsonContent);
        console.log('[Whisper] JSON parsed, keys:', Object.keys(result));

        const segments = [];

        if (result.segments && Array.isArray(result.segments)) {
          console.log('[Whisper] Found', result.segments.length, 'segments');
          result.segments.forEach((seg, idx) => {
            const hasWords = seg.words && Array.isArray(seg.words) && seg.words.length > 0;
            console.log(`[Whisper] Seg ${idx}: "${seg.text}" | Words: ${hasWords ? seg.words.length : 'NONE'}`);

            segments.push({
              text: seg.text || '',
              start: seg.start || 0,
              end: seg.end || 0,
              words: seg.words || []  // ← Capturar array de palavras com timestamps
            });
          });
        }

        console.log('[Whisper] Resolved with', segments.length, 'segments (com words capturadas)');

        try { fs.unlinkSync(jsonPath); } catch(e) {}

        resolve({
          segments: segments,
          language: result.language || 'unknown',
          full_text: result.text || ''
        });
      } catch(parseErr) {
        console.error('[Whisper] Parse error:', parseErr.message);
        reject(new Error(`Erro ao parsear JSON: ${parseErr.message}`));
      }
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// GERADOR DE SRT (Subtitle)
// ═════════════════════════════════════════════════════════════════════════════

function secondsToSRTTimecode(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(millis).padStart(3, '0')}`;
}

/**
 * Gera SRT com word-level segmentation (máximo 7 caracteres, SEM cortar palavras)
 * Agrupa até 2 palavras se couberem em 7 chars, senão 1 palavra completa
 */
function generateSRTFile(segments, outputPath) {
  console.log('[SRT] Gerando SRT com word-level segmentation (max 7 chars, sem cortar palavras)');

  // Coletar todas as palavras de todos os segmentos
  let allWords = [];
  segments.forEach((seg) => {
    if (seg.words && Array.isArray(seg.words)) {
      allWords = allWords.concat(seg.words);
    }
  });

  if (allWords.length === 0) {
    console.error('[SRT] ❌ Nenhuma palavra encontrada (Whisper não retornou word_timestamps)');
    throw new Error('Whisper não retornou word-level timestamps');
  }

  console.log('[SRT] Total de palavras:', allWords.length);

  let srtEntries = [];
  let i = 0;

  // Iterar sobre palavras
  while (i < allWords.length) {
    const currentWord = allWords[i].word.trim();
    const blockStartTime = allWords[i].start;

    if (!currentWord || currentWord.length === 0) {
      i++;
      continue;
    }

    let blockText = currentWord;
    let blockEndTime = allWords[i].end;
    let wordCount = 1;

    // Tentar agregar a próxima palavra se couber em 7 caracteres
    if (i + 1 < allWords.length) {
      const nextWord = allWords[i + 1].word.trim();
      const testCombined = currentWord + ' ' + nextWord;

      if (testCombined.length <= 7) {
        blockText = testCombined;
        blockEndTime = allWords[i + 1].end;
        wordCount = 2;
        i++;  // Avançar para a próxima palavra
      }
    }

    srtEntries.push({
      text: blockText,
      start: blockStartTime,
      end: blockEndTime
    });

    console.log(`[SRT] Bloco (${wordCount} word${wordCount > 1 ? 's' : ''}): "${blockText}" (${blockText.length}ch) [${blockStartTime.toFixed(3)}s - ${blockEndTime.toFixed(3)}s]`);

    i++;
  }

  // Gerar conteúdo do arquivo SRT
  let srtContent = '';
  srtEntries.forEach((entry, idx) => {
    const startTime = secondsToSRTTimecode(entry.start);
    const endTime = secondsToSRTTimecode(entry.end);

    srtContent += `${idx + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${entry.text}\n`;
    srtContent += `\n`;
  });

  try {
    fs.writeFileSync(outputPath, srtContent, 'utf-8');
    console.log('[SRT] ✓ Arquivo criado:', outputPath);
    console.log('[SRT] Total de blocos:', srtEntries.length);
    return outputPath;
  } catch (err) {
    console.error('[SRT] ❌ Erro ao criar arquivo:', err.message);
    throw new Error('Erro ao gerar SRT: ' + err.message);
  }
}

// Expor as funções como objetos para compatibilidade
const transcription = {
  transcribeAudio: transcribeAudio
};

const generateCaptions = {
  generateSRT: generateSRTFile
};

// ═══ MÓDULO 1: Decupagem ═══
let camFolders     = [];
let camProc        = null;
let camSegBuf      = {};
let camStats       = { filesTotal: 0, filesDone: 0, approved: 0, rejected: 0 };
let camCancelled   = false;

// ═══ MÓDULO 2: Remoção de Silêncios ═══
let falaProc       = null;
let falaCancelled  = false;

let insertQueue     = [];
let insertBusy      = false;

function enqueueInsert(fp, segs, seqName, duracao, withAudio) {
  insertQueue.push({ fp, segs, seqName, duracao, withAudio });
  drainInsertQueue();
}

function drainInsertQueue() {
  if (insertBusy || insertQueue.length === 0) return;
  insertBusy = true;
  const { fp, segs, seqName, duracao, withAudio } = insertQueue.shift();
  const arg = JSON.stringify({ file_path: fp, segments: segs, seq_name: seqName, duracao_total: duracao, with_audio: withAudio });
  cs.evalScript(`addFileSegments(${JSON.stringify(arg)})`, res => {
    let r;
    try { r = JSON.parse(res); } catch(e) { r = { error: res }; }
    if (r && r.error) logCam(`Premiere: ${r.error}`, 'error');
    else if (r && r.added) logCam(`  → ${r.added} clipe(s) adicionado(s) na timeline`, 'ok');
    insertBusy = false;
    drainInsertQueue();
  });
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    try {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const tabId = 'tab-' + tab.dataset.tab;
      const panel = document.getElementById(tabId);
      if (panel) panel.classList.add('active');
      if (tab.dataset.tab === 'fala') {
        console.log('[Tab Click] Carregando info de Fala...');
        refreshFalaInfo();
      }
    } catch(e) {
      console.error('[Tab Click Error]', e);
    }
  });
});

function addFolder() {
  cs.evalScript('browseForFolder()', result => {
    if (!result || result === 'null' || result === 'EvalScript Error.') return;
    if (camFolders.includes(result)) return;
    camFolders.push(result);
    renderFolders();
  });
}

function removeFolder(idx) {
  camFolders.splice(idx, 1);
  renderFolders();
}

function renderFolders() {
  const el = document.getElementById('folder-list');
  if (camFolders.length === 0) {
    el.innerHTML = '<div class="folder-empty">Nenhuma pasta selecionada</div>';
    return;
  }
  el.innerHTML = camFolders.map((f, i) => `
    <div class="folder-item">
      <span class="folder-path" title="${f}">${f}</span>
      <button class="btn-remove" onclick="removeFolder(${i})">✕</button>
    </div>`).join('');
}
renderFolders();

function runCamera() {
  if (camFolders.length === 0) {
    alert('Adicione pelo menos uma pasta de rushes.');
    return;
  }

  const allFiles = [];
  camFolders.forEach(folder => {
    try {
      fs.readdirSync(folder)
        .filter(f => f.toLowerCase().endsWith('.mp4'))
        .sort()
        .forEach(f => allFiles.push(path.join(folder, f)));
    } catch(e) {
      logCam(`Erro ao ler pasta: ${folder}`, 'error');
    }
  });

  if (allFiles.length === 0) {
    alert('Nenhum MP4 encontrado nas pastas selecionadas.');
    return;
  }

  const seqName = document.getElementById('cam-seq-name').value.trim() || 'B-Roll Decupado';
  const agr     = document.getElementById('cam-agr').value;
  const win     = document.getElementById('cam-win').value;
  const withAudio = document.getElementById('cam-with-audio').checked ? '1' : '0';

  cs.evalScript(`initSequence(${JSON.stringify(seqName)})`, res => {
    let r;
    try { r = JSON.parse(res); } catch(e) { r = { error: res }; }
    if (r.error) {
      alert('Erro ao criar sequência: ' + r.error);
      return;
    }
    startPython(allFiles, seqName, agr, win, withAudio);
  });
}

function startPython(files, seqName, agr, win, withAudio) {
  camCancelled = false;
  camSegBuf    = {};
  camStats     = { filesTotal: files.length, filesDone: 0, approved: 0, rejected: 0, withAudio: withAudio };

  document.getElementById('cam-progress').style.display = 'block';
  document.getElementById('cam-btn').disabled = true;
  document.getElementById('cam-log').innerHTML = '';
  setProgress('cam-bar', 0);
  setBadge('cam-badge', 'running', 'Rodando');
  updateStats();

  logCam(`${files.length} arquivo(s) encontrado(s). Iniciando análise...`);

  const script = path.join(PYTHON_SCRIPTS, 'analisar_v2_cep.py');
  camProc = spawn('python', [
    '-u',
    script,
    '--agressividade', agr,
    '--window-sec',    win,
  ]);

  camProc.stdin.write(files.join('\n'));
  camProc.stdin.end();

  let lineBuf = '';

  camProc.stdout.on('data', data => {
    lineBuf += data.toString();
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop();
    lines.forEach(line => handlePythonLine(line.trim(), seqName));
  });

  camProc.stderr.on('data', d => {
    const txt = d.toString().trim();
    if (txt) logCam(txt, 'warn');
  });

  camProc.on('close', code => {
    camProc = null;
    document.getElementById('cam-btn').disabled = false;
    if (camCancelled) {
      setBadge('cam-badge', 'warn', 'Cancelado');
      logCam('Análise cancelada. Resultado parcial preservado na timeline.', 'warn');
    } else if (code !== 0) {
      setBadge('cam-badge', 'error', 'Erro');
      logCam(`Processo encerrou com código ${code}`, 'error');
    } else {
      setProgress('cam-bar', 100);
      logCam('Limpando áudio picotado...', 'ok');

      // Limpa a track A2 (áudio lixo)
      cs.evalScript('cleanupAudioTrack()', res => {
        let r;
        try { r = JSON.parse(res); } catch(e) { r = { error: res }; }
        if (r && r.removed !== undefined) {
          logCam(`  → ${r.removed} clipes de áudio removidos`, 'ok');
        }

        setBadge('cam-badge', 'done', 'Concluído');
        logCam(`Pronto! ${camStats.approved} trechos sincronizados com áudio contínuo.`, 'ok');
      });
    }
  });
}

function handlePythonLine(line, seqName) {
  if (!line) return;

  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) { logCam(line); return; }

  const prefix  = line.slice(0, colonIdx);
  let payload;
  try { payload = JSON.parse(line.slice(colonIdx + 1)); }
  catch(e) { logCam(line); return; }

  if (prefix === 'PROGRESS') {
    const pct = payload.pct || 0;
    setProgress('cam-bar', pct);
    document.getElementById('cam-pct-label').textContent = `${Math.round(pct)}%`;
    if (payload.file) {
      document.getElementById('cam-current-file').textContent = payload.file;
    }
    document.getElementById('cam-stat-files').textContent =
      `${payload.idx || 0} / ${payload.total || camStats.filesTotal}`;
    if (payload.eta_sec != null && payload.eta_sec > 0) {
      document.getElementById('cam-stat-eta').textContent = fmtEta(payload.eta_sec);
    }

  } else if (prefix === 'SEGMENT') {
    const fp = payload.file_path;
    if (!camSegBuf[fp]) camSegBuf[fp] = [];
    camSegBuf[fp].push({ start_sec: payload.start_sec, end_sec: payload.end_sec, score: payload.score });

  } else if (prefix === 'FILE_DONE') {
    camStats.filesDone++;
    const fp       = payload.file_path;
    const segs     = camSegBuf[fp] || [];
    const duracao  = payload.duracao_total || 0;
    camStats.approved += segs.length;
    camStats.rejected += payload.approved != null ? (payload.approved === 0 && segs.length === 0 ? 1 : 0) : 0;
    updateStats();

    const nome = path.basename(fp);
    if (segs.length > 0) {
      logCam(`${nome}: ${segs.length} trecho(s) aprovado(s) — aguardando inserção...`);
      enqueueInsert(fp, segs, seqName, duracao, camStats.withAudio);
      delete camSegBuf[fp];
    } else {
      logCam(`${nome}: nenhum trecho aprovado`, 'muted');
    }

  } else if (prefix === 'ERROR') {
    logCam(`ERRO: ${payload.msg || JSON.stringify(payload)}`, 'error');
  }
}

function cancelCamera() {
  if (!camProc) return;
  camCancelled = true;
  camProc.kill('SIGTERM');
}

function updateStats() {
  document.getElementById('cam-stat-approved').textContent = camStats.approved;
  document.getElementById('cam-stat-rejected').textContent = camStats.rejected;
}

function setProgress(barId, pct) {
  document.getElementById(barId).style.width = Math.min(pct, 100) + '%';
}

function setBadge(id, state, text) {
  const b  = document.getElementById(id);
  b.className = 'badge ' + state;
  const dot = state === 'running'
    ? '<span class="dot pulse"></span> '
    : '<span class="dot"></span> ';
  b.innerHTML = dot + text;
}

function logCam(msg, type = '') {
  const el   = document.getElementById('cam-log');
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' ' + type : '');
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function fmtEta(sec) {
  if (sec > 3600) return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}min`;
  if (sec > 60)   return `${Math.floor(sec/60)}min ${Math.round(sec%60)}s`;
  return `${Math.round(sec)}s`;
}

function refreshFalaInfo() {
  cs.evalScript('getActiveSequenceClips()', raw => {
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { error: raw }; }
    const nameEl  = document.getElementById('fala-seq-info');
    const clipsEl = document.getElementById('fala-clips-info');
    if (data.error || !data.clips) {
      nameEl.textContent  = 'Nenhuma sequência aberta';
      clipsEl.textContent = '';
      return;
    }
    nameEl.textContent  = data.seqName || '—';
    const total = data.total || data.clips.length;
    const sel   = data.mode === 'selecao' ? data.clips.length : 0;
    clipsEl.textContent = sel > 0
      ? `${sel} selecionado(s) de ${total} na timeline`
      : `${total} clipe(s) na timeline`;
  });
}

function runFala() {
  document.getElementById('fala-progress').style.display = 'block';
  document.getElementById('fala-btn').disabled = true;
  document.getElementById('fala-log').innerHTML = '';
  setProgress('fala-bar', 0);
  setBadge('fala-badge', 'running', 'Rodando');

  cs.evalScript('getActiveSequenceClips()', raw => {
    let data;
    try { data = JSON.parse(raw); } catch(e) { data = { error: raw }; }
    if (data.error || !data.clips || data.clips.length === 0) {
      logFala('Erro: ' + (data.error || 'Nenhum clipe na sequência ativa.'), 'error');
      setBadge('fala-badge', 'error', 'Erro');
      document.getElementById('fala-btn').disabled = false;
      return;
    }

    const filePaths = [...new Set(data.clips.map(c => c.file_path))];
    const seqName   = document.getElementById('fala-seq-name').value.trim() || 'Decupagem Fala';
    const pausa     = document.getElementById('fala-pausa').value;
    const maxDur    = document.getElementById('fala-maxdur').value;
    const jsonOut   = path.join(PYTHON_SCRIPTS, 'fala_segments.json');
    const script    = path.join(PYTHON_SCRIPTS, 'decupar_fala_cep.py');

    logFala(`${filePaths.length} arquivo(s). Transcrevendo...`);

    const proc = spawn('python', [
      script, '--files-stdin',
      '--pausa', pausa, '--max-dur', maxDur, '--out', jsonOut
    ]);
    proc.stdin.write(filePaths.join('\n'));
    proc.stdin.end();

    proc.stdout.on('data', d => {
      d.toString().split('\n').filter(l => l.trim()).forEach(line => {
        if (line.startsWith('PROGRESS:')) {
          setProgress('fala-bar', parseFloat(line.split(':')[1]));
        } else {
          logFala(line);
        }
      });
    });
    proc.stderr.on('data', d => logFala(d.toString().trim(), 'warn'));
    proc.on('close', code => {
      if (code !== 0) {
        setBadge('fala-badge', 'error', 'Erro');
        document.getElementById('fala-btn').disabled = false;
        return;
      }
      setProgress('fala-bar', 100);
      logFala('Transcrição concluída. Aplicando na timeline...');
      cs.evalScript(`initSequence(${JSON.stringify(seqName)})`, () => {
        try {
          const result = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
          result.segments.forEach(seg => {
            const arg = JSON.stringify({ file_path: seg.file_path, segments: [seg], seq_name: seqName });
            cs.evalScript(`addFileSegments(${JSON.stringify(arg)})`, () => {});
          });
          setBadge('fala-badge', 'done', 'Concluído');
          logFala(`Pronto! ${result.segments.length} blocos adicionados.`, 'ok');
        } catch(e) {
          logFala('Erro ao ler resultado: ' + e.message, 'error');
          setBadge('fala-badge', 'error', 'Erro');
        }
        document.getElementById('fala-btn').disabled = false;
      });
    });
  });
}

// ═══ MÓDULO 2: Remoção de Silêncios ═══

function processAudioForSilences(audioPath, threshold, minDuration) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(audioPath)) {
      return reject(new Error(`Arquivo não encontrado: ${audioPath}`));
    }

    let ffmpegOutput = '';
    const args = [
      '-i', audioPath,
      '-af', `silencedetect=n=${threshold}dB:d=${minDuration}`,
      '-f', 'null',
      '-'
    ];

    const proc = spawn('ffmpeg', args);

    proc.stderr.on('data', (data) => {
      ffmpegOutput += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        return reject(new Error(`FFmpeg retornou código ${code}`));
      }

      const silences = [];
      const silenceStartRegex = /silence_start:\s+([\d.]+)/g;
      const silenceEndRegex = /silence_end:\s+([\d.]+)\s+\|\s+silence_duration:\s+([\d.]+)/g;

      let match;
      const starts = [];

      while ((match = silenceStartRegex.exec(ffmpegOutput)) !== null) {
        starts.push(parseFloat(match[1]));
      }

      let index = 0;
      while ((match = silenceEndRegex.exec(ffmpegOutput)) !== null) {
        const end = parseFloat(match[1]);
        const duration = parseFloat(match[2]);
        const start = starts[index] || (end - duration);

        silences.push({
          start_sec: parseFloat(start.toFixed(3)),
          end_sec: parseFloat(end.toFixed(3)),
          duration: parseFloat(duration.toFixed(3))
        });

        index++;
      }

      // Cleanup
      try {
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      } catch(e) {}

      resolve({ silences: silences, count: silences.length, cleanupDone: true });
    });
  });
}

function runFala() {
  const threshold = parseInt(document.getElementById('fala-threshold').value);
  const minDur    = parseFloat(document.getElementById('fala-mindur').value) / 1000; // ms → s
  const seqName   = document.getElementById('fala-seq-name').value.trim() || 'Decupagem Fala';

  document.getElementById('fala-btn').disabled = true;
  document.getElementById('fala-progress').style.display = 'flex';
  setBadge('fala-badge', 'running', 'Obtendo arquivo de origem...');
  logFala(`Obtendo arquivo de origem da sequência...`);

  cs.evalScript('exportSequenceAudio()', (res) => {
    let result;
    try { result = JSON.parse(res); } catch(e) { result = { error: res }; }

    if (result.error) {
      logFala(`Erro: ${result.error}`, 'error');
      setBadge('fala-badge', 'error', 'Erro');
      document.getElementById('fala-btn').disabled = false;
      return;
    }

    const sourceFile = result.sourceFile;
    logFala(`✓ Arquivo de origem: ${path.basename(sourceFile)}`);
    logFala(`Extraindo e processando áudio...`);
    setBadge('fala-badge', 'running', 'Processando...');

    // Chamar módulo de silêncios
    removeSilences(sourceFile, threshold, minDur, seqName);
  });
}

function removeSilences(videoPath, threshold, minDuration, seqName) {
  logFala(`Extraindo áudio (isso pode levar alguns segundos)...`);

  // Extrair áudio do MOV usando FFmpeg com melhor performance
  const audioPath = videoPath.replace(/\.(mov|mp4)$/i, '.wav');
  const ffmpegPath = 'ffmpeg';

  // Flags otimizadas: -y=overwrite, -threads auto, -acodec pcm_s16le (rápido)
  const ffmpegArgs = [
    '-y',  // overwrite sem perguntar
    '-i', videoPath,
    '-vn',  // sem vídeo
    '-acodec', 'pcm_s16le',
    '-ar', '44100',
    '-threads', 'auto',
    audioPath
  ];

  console.log('[FFmpeg Extract] Iniciando com:', ffmpegArgs.join(' '));
  const ffmpeg = spawn(ffmpegPath, ffmpegArgs);
  let ffmpegErr = '';
  let lastProgress = Date.now();

  ffmpeg.stderr.on('data', (data) => {
    ffmpegErr += data.toString();

    // Log de progresso do FFmpeg a cada 2 segundos
    const now = Date.now();
    if (now - lastProgress > 2000) {
      const lines = ffmpegErr.split('\n');
      const timeLine = lines.find(l => l.includes('time='));
      if (timeLine) logFala(`  ⏳ ${timeLine.trim()}`, 'muted');
      lastProgress = now;
    }
  });

  ffmpeg.on('error', (err) => {
    logFala(`Erro ao executar FFmpeg: ${err.message}`, 'error');
    setBadge('fala-badge', 'error', 'Erro');
    document.getElementById('fala-btn').disabled = false;
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      logFala(`Falha na extração (código ${code})`, 'error');
      logFala(`  Verify: ${ffmpegErr.split('\n').slice(-3).join(' ')}`, 'error');
      setBadge('fala-badge', 'error', 'Erro');
      document.getElementById('fala-btn').disabled = false;
      return;
    }

    logFala(`✓ Áudio extraído`);

    // Agora processar com silencedetect
    processAudioForSilences(audioPath, threshold, minDuration)
      .then((result) => {
        const { silences, count } = result;
        logFala(`✓ Encontrados ${count} silêncio(s)`);

        if (count === 0) {
          logFala('Nenhum silêncio detectado.', 'warn');
          setBadge('fala-badge', 'done', 'Pronto');
          document.getElementById('fala-btn').disabled = false;
          return;
        }

        // Exibir timestamps dos silêncios
        silences.forEach((s, i) => {
          logFala(`  ${i + 1}. [${s.start_sec.toFixed(2)}s → ${s.end_sec.toFixed(2)}s] (${s.duration.toFixed(3)}s)`, 'muted');
        });

        logFala(`Aplicando Ripple Delete na timeline...`);
        setBadge('fala-badge', 'running', 'Removendo silêncios...');

        // Passar timestamps para ExtendScript remover
        const arg = JSON.stringify({ seq_name: seqName, silences: silences });
        cs.evalScript(`removeSilencesFromTimeline(${JSON.stringify(arg)})`, (res) => {
          let r;
          try { r = JSON.parse(res); } catch(e) { r = { error: res }; }

          if (r.error) {
            logFala(`Erro ao remover silêncios: ${r.error}`, 'error');
            setBadge('fala-badge', 'error', 'Erro');
          } else {
            logFala(`✓ ${r.removed || 0} silêncio(s) removido(s)`, 'ok');
            setBadge('fala-badge', 'done', 'Pronto');
          }
          document.getElementById('fala-btn').disabled = false;
        });
      })
      .catch((err) => {
        logFala(`Erro ao processar áudio: ${err.message}`, 'error');
        setBadge('fala-badge', 'error', 'Erro');
        document.getElementById('fala-btn').disabled = false;
      });
  });
}

/**
 * MÓDULO 4: Gerar captions (exportar WAV da timeline → transcrever → importar SRT → inserir na timeline)
 */
function runCaptions() {
  console.log('[runCaptions] === INICIANDO GERAÇÃO DE CAPTIONS ===');

  logFala('Iniciando geração de captions...');
  console.log('[runCaptions] ✓ Sistema pronto');

  document.getElementById('fala-btn').disabled = true;
  document.getElementById('fala-progress').style.display = 'flex';
  setBadge('fala-badge', 'running', 'Exportando áudio da timeline...');

  // Passo 1: Exportar áudio da sequência ativa (com cortes aplicados)
  console.log('[runCaptions] Chamando exportSequenceAudio...');

  // Calcular caminho do preset .epr empacotado
  // O arquivo geekko_audio.epr está na raiz da extensão (com.geekko.decupagem/)
  console.log('[DEBUG] __dirname:', __dirname);

  const eprPath = path.join(__dirname, '..', 'geekko_audio.epr');
  console.log('[runCaptions] EPR path calculated:', eprPath);
  console.log('[runCaptions] EPR exists:', fs.existsSync(eprPath));

  // Se não encontrar, tentar sem subir um nível (arquivo pode estar em /js)
  let finalEprPath = eprPath;
  if (!fs.existsSync(eprPath)) {
    const eprPathAlt = path.join(__dirname, 'geekko_audio.epr');
    console.log('[runCaptions] EPR not found, trying alternative:', eprPathAlt);
    if (fs.existsSync(eprPathAlt)) {
      finalEprPath = eprPathAlt;
      console.log('[runCaptions] ✓ Found EPR in /js folder');
    }
  }

  const exportArgs = JSON.stringify({ eprPath: finalEprPath });
  cs.evalScript(`exportSequenceAudio(${JSON.stringify(exportArgs)})`, (res) => {
    console.log('[runCaptions] Response:', res);
    let result;
    try { result = JSON.parse(res); } catch(e) {
      console.error('[runCaptions] Parse error:', e, 'response:', res);
      result = { error: res };
    }

    if (result.error) {
      console.error('[runCaptions] Error from ExtendScript:', result.error);
      logFala(`❌ ${result.error}`, 'error');
      setBadge('fala-badge', 'error', 'Erro');
      document.getElementById('fala-btn').disabled = false;
      return;
    }

    const audioPath = result.audioPath;
    console.log('[runCaptions] Audio path (from sequence):', audioPath);
    logFala(`✓ Áudio exportado da timeline`);
    logFala('⏳ Transcrevendo (isso leva alguns minutos)...');
    setBadge('fala-badge', 'running', 'Transcrevendo...');

    // Passo 2: Transcrever o áudio exportado
    if (!transcription) {
      logFala('❌ Módulo de transcrição não carregou', 'error');
      document.getElementById('fala-btn').disabled = false;
      return;
    }

    transcription.transcribeAudio(audioPath, 'base')
      .then((transcriptResult) => {
        console.log('[Transcription] Result:', transcriptResult);
        logFala(`✓ Transcrição: ${transcriptResult.segments.length} segmentos`);
        logFala('Gerando arquivo SRT...');
        setBadge('fala-badge', 'running', 'Gerando...');

        // Passo 3: Gerar arquivo SRT
        const srtPath = path.join(path.dirname(audioPath), 'geekko_captions.srt');
        generateSRTFile(transcriptResult.segments, srtPath);
        logFala('✓ SRT gerado');
        logFala('Importando e inserindo SRT na timeline...');
        setBadge('fala-badge', 'running', 'Inserindo...');

        // Passo 4: Importar SRT e inserir na timeline
        const arg = JSON.stringify({
          srtPath: srtPath
        });
        cs.evalScript(`importSRTFile(${JSON.stringify(arg)})`, (importRes) => {
          console.log('[importSRT] Response:', importRes);
          let r;
          try { r = JSON.parse(importRes); } catch(e) { r = { error: importRes }; }

          if (r.error) {
            logFala(`❌ ${r.error}`, 'error');
            setBadge('fala-badge', 'error', 'Erro');
          } else if (r.imported) {
            logFala(`✅ ${r.note}`, 'ok');
            setBadge('fala-badge', 'done', 'Pronto!');
          } else if (r.success) {
            logFala(`⚠️ ${r.note}`, 'warn');
            setBadge('fala-badge', 'warn', 'Parcial');
          }

          // Limpar arquivo temporário de áudio
          try {
            if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
          } catch(e) {}

          document.getElementById('fala-btn').disabled = false;
        });
      })
      .catch((err) => {
        console.error('[Captions Error]', err);
        logFala(`❌ ${err.message}`, 'error');
        setBadge('fala-badge', 'error', 'Erro');
        document.getElementById('fala-btn').disabled = false;
        try {
          const audioPath = result.audioPath;
          if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        } catch(e) {}
      });
  });
}

function logFala(msg, type = '') {
  const el   = document.getElementById('fala-log');
  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' ' + type : '');
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function runSync() {
  const btn = document.getElementById('fala-sync-btn');
  const progressSection = document.getElementById('sync-progress');
  const logEl = document.getElementById('sync-log');
  const statusEl = document.getElementById('sync-current-file');
  const badgeEl = document.getElementById('sync-badge');

  btn.disabled = true;
  progressSection.style.display = 'block';
  logEl.innerHTML = '';

  // Construir caminho absoluto do sync_engine.py
  // Assumindo que está na pasta raiz do projeto
  const syncEnginePath = path.join(
    path.dirname(__dirname),
    'sync_engine.py'
  );

  console.log('[Sync] Iniciando sincronização de multicam');
  console.log('[Sync] Caminho:', syncEnginePath);

  // Verificar se o arquivo existe
  if (!fs.existsSync(syncEnginePath)) {
    const altPath = 'C:\\Users\\Wellington\\Desktop\\Geekko\\Automação\\sync_engine.py';
    if (fs.existsSync(altPath)) {
      console.log('[Sync] Usando caminho alternativo:', altPath);
      executeSync(altPath, btn, progressSection, logEl, statusEl, badgeEl);
    } else {
      logSync('❌ Arquivo sync_engine.py não encontrado!', 'error', logEl);
      setBadge('sync-badge', 'error', 'Erro');
      btn.disabled = false;
      progressSection.style.display = 'block';
      return;
    }
  } else {
    executeSync(syncEnginePath, btn, progressSection, logEl, statusEl, badgeEl);
  }
}

function executeSync(scriptPath, btn, progressSection, logEl, statusEl, badgeEl) {
  const cmd = `python "${scriptPath}"`;

  logSync('🔄 Analisando timeline...', 'info', logEl);
  statusEl.textContent = 'Analisando timeline...';

  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      logSync(`❌ Erro ao executar sync_engine.py: ${error.message}`, 'error', logEl);
      if (stderr) {
        logSync(`STDERR: ${stderr}`, 'error', logEl);
      }
      setBadge('sync-badge', 'error', 'Erro');
    } else {
      // Exibir saída do script
      if (stdout) {
        const lines = stdout.split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            logSync(line, 'info', logEl);
          }
        });
      }

      if (stderr) {
        logSync(`⚠️ ${stderr}`, 'warn', logEl);
      }

      logSync('✅ Sincronização concluída!', 'ok', logEl);
      statusEl.textContent = 'Timeline analisada com sucesso!';
      setBadge('sync-badge', 'done', 'Pronto!');
      showToast('✅ Timeline analisada com sucesso!', 'ok');
    }

    btn.disabled = false;
  });
}

function logSync(msg, type = '', el = null) {
  const logEl = el || document.getElementById('sync-log');
  if (!logEl) return;

  const line = document.createElement('div');
  line.className = 'log-line' + (type ? ' ' + type : '');
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;

  // Também mostrar no console do desenvolvedor
  if (type === 'error') {
    console.error('[Sync]', msg);
  } else if (type === 'warn') {
    console.warn('[Sync]', msg);
  } else {
    console.log('[Sync]', msg);
  }
}

function setBadge(badgeId, status, text) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;

  badge.className = 'badge ' + status;
  if (status === 'running') {
    badge.innerHTML = '<span class="dot pulse"></span> ' + text;
  } else {
    badge.textContent = text;
  }
}
