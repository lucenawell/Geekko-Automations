/**
 * Módulo 3: Transcrição com Whisper.cpp
 * Extrai transcrição de áudio com timestamps
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Transcreve áudio com Whisper.cpp
 * @param {string} audioPath - Caminho do arquivo .wav
 * @param {string} model - Modelo: 'tiny', 'base', 'small'
 * @returns {Promise<Object>} { segments: [{text, start, end}], language }
 */
function transcribeAudio(audioPath, model = 'base') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(audioPath)) {
      return reject(new Error(`Arquivo não encontrado: ${audioPath}`));
    }

    // Usar Whisper instalado
    const whisperPath = 'C:\\Users\\Wellington\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\whisper.exe';
    const outputDir = path.dirname(audioPath);

    const args = [
      audioPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', outputDir,  // Whisper salva JSON no disco
      '--task', 'transcribe'
    ];

    console.log('[Whisper] Iniciando transcrição...');
    const proc = spawn(whisperPath, args);

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log de progresso
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
        // Whisper salva resultado em {audioBaseName}.json
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

        // Formato: { "text": "...", "segments": [...] }
        if (result.segments && Array.isArray(result.segments)) {
          console.log('[Whisper] Found', result.segments.length, 'segments');
          result.segments.forEach((seg, idx) => {
            segments.push({
              text: seg.text || '',
              start: seg.start || 0,
              end: seg.end || 0
            });
            console.log(`[Whisper] Seg ${idx}: "${seg.text}" [${seg.start}-${seg.end}]`);
          });
        }

        console.log('[Whisper] Resolved with', segments.length, 'segments');

        // Limpar arquivo JSON temporário
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

module.exports = {
  transcribeAudio
};
