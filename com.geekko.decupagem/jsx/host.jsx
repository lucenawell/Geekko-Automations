// ExtendScript host — Premiere Pro

var _targetSequence  = null;
var _nextInsertTick  = 0;
var TICKS            = 254016000000;

function browseForFolder() {
  var folder = Folder.selectDialog("Selecione a pasta com os rushes");
  return folder ? folder.fsName : null;
}

function getActiveSequenceClips() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: "Nenhuma sequencia ativa." });
    var allClips = [], selClips = [];
    var tracks = seq.videoTracks;
    for (var t = 0; t < tracks.numTracks; t++) {
      for (var c = 0; c < tracks[t].clips.numItems; c++) {
        var clip = tracks[t].clips[c];
        var fp = "";
        try { fp = clip.projectItem.getMediaPath(); } catch(e) {}
        if (!fp) continue;
        var obj = { file_path: fp, name: clip.projectItem.name, selected: clip.isSelected() };
        allClips.push(obj);
        if (clip.isSelected()) selClips.push(obj);
      }
    }
    var result = selClips.length > 0 ? selClips : allClips;
    return JSON.stringify({ clips: result, total: allClips.length, seqName: seq.name,
                            mode: selClips.length > 0 ? "selecao" : "todos" });
  } catch(e) { return JSON.stringify({ error: e.message || String(e) }); }
}

function initSequence(seqName) {
  try {
    for (var i = 0; i < app.project.sequences.numSequences; i++) {
      if (app.project.sequences[i].name === seqName) {
        _targetSequence = app.project.sequences[i];
        app.project.activeSequence = _targetSequence;
        _nextInsertTick = getSeqEndTick(_targetSequence);
        return JSON.stringify({ ok: true, created: false });
      }
    }
    app.project.createNewSequence(seqName, "gk-" + new Date().getTime());
    _targetSequence = app.project.sequences[app.project.sequences.numSequences - 1];
    app.project.activeSequence = _targetSequence;
    _nextInsertTick = 0;
    return JSON.stringify({ ok: true, created: true });
  } catch(e) { return JSON.stringify({ error: e.message || String(e) }); }
}

function addFileSegments(jsonStr) {
  try {
    var data      = JSON.parse(jsonStr);
    var filePath  = data.file_path;
    var segments  = data.segments;
    var seqName   = data.seq_name || "Geekko Decupagem";
    var withAudio = data.with_audio === '1' || data.with_audio === 1 || data.with_audio === true;

    if (!_targetSequence || _targetSequence.name !== seqName) {
      var r = JSON.parse(initSequence(seqName));
      if (r.error) return JSON.stringify({ error: r.error });
    }
    var seq = _targetSequence;

    var item = findVideoProjectItem(app.project.rootItem, filePath);
    if (!item) {
      app.project.importFiles([filePath], false, app.project.rootItem, false);
      item = findVideoProjectItem(app.project.rootItem, filePath);
    }
    if (!item) return JSON.stringify({ error: "Falha ao importar: " + filePath });

    var added = 0;

    // Insere apenas clipes de VÍDEO cortados, um do lado do outro
    for (var i = 0; i < segments.length; i++) {
      var seg     = segments[i];
      var inTick  = Math.round(seg.start_sec * TICKS);
      var outTick = Math.round(seg.end_sec   * TICKS);
      var durTick = outTick - inTick;
      if (durTick <= 0) continue;

      var inTime  = new Time(); inTime.ticks  = String(inTick);
      var outTime = new Time(); outTime.ticks = String(outTick);

      // Define in/out no arquivo original
      try { item.setInPoint(inTime, 4); item.setOutPoint(outTime, 4); } catch(e) {}

      var insTime = new Time();
      insTime.ticks = String(_nextInsertTick);

      var ok = false;
      try {
        // Insere clipe na V1
        seq.videoTracks[0].insertClip(item, insTime);
        ok = true;
      } catch(e) {}

      // Se withAudio, tenta inserir também em A1
      if (ok && withAudio && seq.audioTracks.numTracks > 0) {
        try {
          seq.audioTracks[0].insertClip(item, insTime);
        } catch(e) {}
      }

      // Limpa in/out
      try { item.setInPoint(new Time(), 4); item.setOutPoint(new Time(), 4); } catch(e) {}

      if (!ok) continue;

      _nextInsertTick += durTick;
      added++;
    }

    return JSON.stringify({ added: added, filePath: filePath });
  } catch(e) { return JSON.stringify({ error: e.message || String(e) }); }
}

function getSeqEndTick(seq) {
  var max = 0;
  var vt = seq.videoTracks[0];
  for (var i = 0; i < vt.clips.numItems; i++) {
    var e = parseInt(vt.clips[i].end.ticks);
    if (e > max) max = e;
  }
  return max;
}

function findVideoProjectItem(bin, targetPath) {
  var norm     = targetPath.replace(/\//g, "\\").toLowerCase();
  var fallback = null;

  for (var i = 0; i < bin.children.numItems; i++) {
    var item = bin.children[i];
    if (item.type === ProjectItemType.CLIP) {
      try {
        if (item.getMediaPath().replace(/\//g, "\\").toLowerCase() !== norm) continue;
        var interp = item.getFootageInterpretation();
        if (interp && interp.frameRate && interp.frameRate > 0) return item;
        if (!fallback) fallback = item;
      } catch(e) {}
    } else if (item.type === ProjectItemType.BIN) {
      var found = findVideoProjectItem(item, targetPath);
      if (found) return found;
    }
  }
  return fallback;
}

function findProjectItem(bin, targetPath) {
  return findVideoProjectItem(bin, targetPath);
}

/**
 * Exporta o áudio da sequência ativa como WAV temporário
 * Usa o preset .epr passado pelo Node.js
 * Respeita os cortes aplicados na timeline
 */
function exportSequenceAudio(jsonStr) {
  try {
    var data = JSON.parse(jsonStr);
    var eprPath = data.eprPath || "";

    var seq = app.project.activeSequence;
    if (!seq) return JSON.stringify({ error: "Nenhuma sequência ativa" });

    if (!seq.audioTracks || seq.audioTracks.numTracks === 0) {
      return JSON.stringify({ error: "Nenhuma faixa de áudio na sequência" });
    }

    if (!eprPath || eprPath.length === 0) {
      return JSON.stringify({ error: "Caminho do preset .epr não fornecido" });
    }

    // Validação estrita do arquivo .epr
    var eprFile = new File(eprPath);
    if (!eprFile.exists) {
      return JSON.stringify({ error: "geekko_audio.epr não encontrado em " + eprPath });
    }

    // Gerar caminho temporário para o WAV
    var tempFolder = new Folder(Folder.temp);
    var wavFileName = "geekko_audio_" + new Date().getTime() + ".wav";
    var wavPath = tempFolder.fsName + "/" + wavFileName;

    // Log de debug dos parâmetros
    var debugMsg = "exportAsMediaDirect params:\n" +
      "- wavPath: " + wavPath + "\n" +
      "- eprPath: " + eprPath + "\n" +
      "- encodeMode: app.encoder.ENCODE_ENTIRE\n" +
      "- seq: " + seq.name + "\n" +
      "- EPR exists: " + eprFile.exists;

    alert("[DEBUG] " + debugMsg);

    // Exportar áudio da sequência usando a API correta
    seq.exportAsMediaDirect(
      new File(wavPath).fsName,
      new File(eprPath).fsName,
      app.encoder.ENCODE_ENTIRE
    );

    // Aguardar conclusão da exportação
    $.sleep(2000);

    // Verificar se o arquivo foi criado
    var wavFile = new File(wavPath);
    if (wavFile.exists && wavFile.length > 1000) {
      return JSON.stringify({ ok: true, audioPath: wavPath });
    } else {
      return JSON.stringify({ error: "Falha ao exportar áudio (arquivo vazio ou não criado). Tamanho: " + wavFile.length });
    }

  } catch(e) {
    return JSON.stringify({ error: "Erro ao exportar áudio: " + e.message + " (linha " + e.line + ")" });
  }
}

function removeSilencesFromTimeline(jsonStr) {
  try {
    var data = JSON.parse(jsonStr);
    var silences = data.silences || [];

    // Usar sequência ativa
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ error: "Nenhuma sequência ativa" });
    }

    if (silences.length === 0) {
      return JSON.stringify({ removed: 0 });
    }

    var TICKS = 254016000000;

    // Ativar QE DOM pra razor()
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var timebase = parseInt(seq.timebase, 10);

    // PASSO 1: Desabilitar clipes nos ranges de silêncio (preview)
    silences.sort(function(a, b) { return b.start_sec - a.start_sec; });

    for (var s = 0; s < silences.length; s++) {
      var silence = silences[s];
      var startTick = Math.round(silence.start_sec * TICKS);
      var endTick = Math.round(silence.end_sec * TICKS);

      startTick = Math.round(startTick / timebase) * timebase;
      endTick = Math.round(endTick / timebase) * timebase;

      var numV = seq.videoTracks.numTracks;
      var numA = seq.audioTracks.numTracks;

      for (var t = 0; t < Math.max(numV, numA); t++) {
        if (t < numV) {
          try {
            var qeVTrack = qeSeq.getVideoTrackAt(t);
            _razorAndDisable(seq.videoTracks[t], qeVTrack, startTick, endTick, timebase, seq);
          } catch(e) {}
        }
        if (t < numA) {
          try {
            var qeATrack = qeSeq.getAudioTrackAt(t);
            _razorAndDisable(seq.audioTracks[t], qeATrack, startTick, endTick, timebase, seq);
          } catch(e) {}
        }
      }
    }

    // PASSO 2: Remover TODOS os clipes desabilitados com ripple
    var removedCount = _removeDisabledAndRipple(seq);

    return JSON.stringify({ success: true, removed: removedCount });
  } catch(e) {
    return JSON.stringify({ error: e.message || String(e) });
  }
}

/**
 * Faz razor() nos limites e DESABILITA clipes (preview/escuro)
 * Baseado na estratégia do AutoEdit
 */
function _razorAndDisable(track, qeTrack, startTick, endTick, timebase, seq) {
  // Razor no fim primeiro (endTick)
  try {
    var timecodeEnd = _ticksToTimecode(endTick, seq);
    if (_hasClipAtTime(track, endTick)) {
      qeTrack.razor(timecodeEnd);
    }
  } catch(e) {}

  // Razor no início (startTick)
  try {
    var timecodeStart = _ticksToTimecode(startTick, seq);
    if (_hasClipAtTime(track, startTick)) {
      qeTrack.razor(timecodeStart);
    }
  } catch(e) {}

  // Desabilitar clipes dentro do range (fica escuro/preto)
  for (var c = 0; c < track.clips.numItems; c++) {
    try {
      var clip = track.clips[c];
      var clipStart = parseInt(clip.start.ticks, 10);
      var clipEnd = parseInt(clip.end.ticks, 10);

      if (clipStart >= startTick && clipEnd <= endTick) {
        clip.disabled = true;
      }
    } catch(e) {}
  }
}

/**
 * Remove TODOS os clipes desabilitados com ripple delete
 * Estratégia do AutoEdit: removeDisabledAndRipple
 */
function _removeDisabledAndRipple(seq) {
  var removedCount = 0;

  // Video tracks (iterando de trás pra frente para índices estáveis)
  for (var v = 0; v < seq.videoTracks.numTracks; v++) {
    var vTrack = seq.videoTracks[v];
    for (var c = vTrack.clips.numItems - 1; c >= 0; c--) {
      try {
        var clip = vTrack.clips[c];
        if (clip.disabled === true) {
          clip.remove(true, true);  // (ripple, alignToVideo)
          removedCount++;
        }
      } catch(e) {}
    }
  }

  // Audio tracks (iterando de trás pra frente)
  for (var a = 0; a < seq.audioTracks.numTracks; a++) {
    var aTrack = seq.audioTracks[a];
    for (var ac = aTrack.clips.numItems - 1; ac >= 0; ac--) {
      try {
        var aClip = aTrack.clips[ac];
        if (aClip.disabled === true) {
          aClip.remove(true, true);  // (ripple, alignToVideo)
          removedCount++;
        }
      } catch(e) {}
    }
  }

  return removedCount;
}

/**
 * Verifica se há clipe em um tempo específico
 */
function _hasClipAtTime(track, timeTicks) {
  for (var i = 0; i < track.clips.numItems; i++) {
    var clipStart = parseInt(track.clips[i].start.ticks, 10);
    var clipEnd = parseInt(track.clips[i].end.ticks, 10);
    if (timeTicks >= clipStart && timeTicks < clipEnd) {
      return true;
    }
  }
  return false;
}

/**
 * Converte ticks para timecode string (necessário pra razor())
 */
function _ticksToTimecode(ticks, seq) {
  var t = new Time();
  t.ticks = String(ticks);
  var seqSettings = seq.getSettings();
  return t.getFormatted(seqSettings.videoFrameRate, seq.videoDisplayFormat);
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO 4: CAPTIONS - Simples importação de SRT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Importa arquivo SRT no Project Bin e tenta inserir na timeline ativa
 * Sem criar sequence nova - apenas na sequence já aberta
 */
function importSRTFile(jsonStr) {
  try {
    var data = JSON.parse(jsonStr);
    var srtPath = data.srtPath || "";

    if (!srtPath || srtPath.length === 0) {
      return JSON.stringify({ error: "Caminho do SRT não fornecido" });
    }

    var srtFile = new File(srtPath);
    if (!srtFile.exists) {
      return JSON.stringify({ error: "Arquivo SRT não encontrado: " + srtPath });
    }

    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ error: "Nenhuma sequência ativa" });
    }

    // Importar SRT para o Project Bin
    var imported = app.project.importFiles([srtPath], true, app.project.rootItem, false);

    if (!imported || imported === false) {
      return JSON.stringify({
        success: false,
        imported: false,
        note: "Falha ao importar arquivo SRT para o Project Bin"
      });
    }

    $.sleep(500);  // Aguardar indexação do arquivo

    // Localizar o ProjectItem do SRT importado
    var srtProjectItem = null;

    function findSRTInBin(bin) {
      for (var i = 0; i < bin.children.numItems; i++) {
        var item = bin.children[i];
        if (item.type === ProjectItemType.CLIP && item.name.indexOf(".srt") >= 0) {
          try {
            if (item.getMediaPath && item.getMediaPath() === srtPath) {
              return item;
            }
          } catch(e) {}
        } else if (item.type === ProjectItemType.BIN) {
          var found = findSRTInBin(item);
          if (found) return found;
        }
      }
      return null;
    }

    srtProjectItem = findSRTInBin(app.project.rootItem);

    // Se não localizou, apenas deixa no Project Bin
    if (!srtProjectItem) {
      return JSON.stringify({
        success: true,
        imported: false,
        note: "SRT importado no Project Bin. Arraste para a timeline para aplicar legendas."
      });
    }

    // Tentar inserir SRT na timeline ativa (na primeira track de vídeo)
    var insertionAttempted = false;
    var insertionSucceeded = false;

    try {
      var startTime = new Time();
      startTime.seconds = 0;

      if (seq.videoTracks && seq.videoTracks.numTracks > 0) {
        insertionAttempted = true;
        seq.videoTracks[0].insertClip(srtProjectItem, startTime);
        insertionSucceeded = true;
      }
    } catch(insertError) {
      // Inserção falhou - deixa apenas no Project Bin
      insertionAttempted = true;
      insertionSucceeded = false;
    }

    // Retornar status da inserção
    if (insertionSucceeded) {
      return JSON.stringify({
        success: true,
        imported: true,
        note: "SRT importado e inserido na timeline com sucesso!"
      });
    } else if (insertionAttempted) {
      // Tentou inserir mas falhou - limitação da API
      return JSON.stringify({
        success: true,
        imported: false,
        limitation: "API do Premiere não suporta inserção programática de SRT em Caption Tracks. Arraste manualmente do Project Bin para a timeline.",
        note: "SRT está pronto no Project Bin - faça drag-and-drop para a timeline."
      });
    } else {
      // Não tinha track de vídeo
      return JSON.stringify({
        success: true,
        imported: false,
        note: "SRT importado no Project Bin. Nenhuma track de vídeo disponível para inserção automática."
      });
    }

  } catch(e) {
    return JSON.stringify({
      error: "Erro ao importar SRT: " + e.message
    });
  }
}
