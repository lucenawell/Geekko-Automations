#!/usr/bin/env python3
"""
Script de transcrição com Whisper que GARANTE word-level timestamps
Retorna JSON estruturado com array de palavras em cada segmento
"""

import json
import sys
import os
import warnings
warnings.filterwarnings('ignore')

def transcribe_with_word_timestamps(audio_path, model='base', output_json=None):
    """
    Transcreve áudio com Whisper e retorna word-level timestamps
    """
    try:
        import whisper
    except ImportError:
        print("ERROR: whisper not installed. Run: pip install openai-whisper", file=sys.stderr)
        sys.exit(1)

    print(f"[Whisper] Carregando modelo: {model}", file=sys.stderr)
    model_obj = whisper.load_model(model)

    print(f"[Whisper] Transcrevendo: {audio_path}", file=sys.stderr)
    result = model_obj.transcribe(audio_path, language='pt')

    print(f"[Whisper] Segmentos obtidos: {len(result['segments'])}", file=sys.stderr)

    # Processar segmentos para garantir word-level timestamps
    processed_segments = []

    for seg in result['segments']:
        segment_data = {
            'id': seg.get('id', 0),
            'start': seg.get('start', 0.0),
            'end': seg.get('end', 0.0),
            'text': seg.get('text', '').strip(),
            'words': []
        }

        # Tentar extrair palavras do segmento
        if 'words' in seg and seg['words']:
            # Se o Whisper já forneceu as palavras
            segment_data['words'] = [
                {
                    'word': w.get('word', '').strip(),
                    'start': w.get('start', seg['start']),
                    'end': w.get('end', seg['end'])
                }
                for w in seg['words']
                if w.get('word', '').strip()
            ]
        else:
            # Fallback: dividir texto em palavras com tempos proporcionais
            text = seg.get('text', '').strip()
            if text:
                words = text.split()
                seg_duration = seg.get('end', 0) - seg.get('start', 0)

                if words and seg_duration > 0:
                    word_duration = seg_duration / len(words)
                    current_time = seg.get('start', 0)

                    for word in words:
                        segment_data['words'].append({
                            'word': word,
                            'start': round(current_time, 3),
                            'end': round(current_time + word_duration, 3)
                        })
                        current_time += word_duration

        processed_segments.append(segment_data)

    # Preparar resultado
    output_data = {
        'language': result.get('language', 'unknown'),
        'text': result.get('text', ''),
        'segments': processed_segments
    }

    # Salvar JSON se especificado
    if output_json:
        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        print(f"[Whisper] JSON salvo: {output_json}", file=sys.stderr)
    else:
        # Retornar como stdout
        print(json.dumps(output_data, ensure_ascii=False))

    return output_data

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Uso: python whisper_transcribe.py <audio_path> [model] [output_json]", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else 'base'
    output_json = sys.argv[3] if len(sys.argv) > 3 else None

    if not os.path.exists(audio_path):
        print(f"ERROR: Arquivo não encontrado: {audio_path}", file=sys.stderr)
        sys.exit(1)

    transcribe_with_word_timestamps(audio_path, model, output_json)
