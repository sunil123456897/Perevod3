import argparse
import json
import os
import sys
import time
import torch
from sentence_transformers import SentenceTransformer

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_embedding_model(model_id: str = "google/embeddinggemma-2"):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    model = SentenceTransformer(
        model_id,
        trust_remote_code=True,
        device=device,
        model_kwargs={"dtype": dtype},
    )
    return model, device


def run_self_test(model_id: str):
    t0 = time.time()
    sys.stderr.write(f"[embed-bridge] Loading {model_id}...\n")
    sys.stderr.flush()
    model, device = load_embedding_model(model_id)
    load_sec = round(time.time() - t0, 2)

    samples = [
        'Camellia shook her head: "I know I shouldn\'t have."',
        'Камелия качнула головой: «Знаю, что не стоило».',
        'Silas drew his heavy broadsword and stepped into the snow-covered courtyard.',
        'Сайлас обнажил тяжёлый палаш и шагнул в заснеженный двор.',
        'The carriage rattled along the cobblestone road toward the academy.',
    ]
    t1 = time.time()
    embs = model.encode(samples, normalize_embeddings=True, show_progress_bar=False)
    enc_ms = round((time.time() - t1) * 1000, 1)

    cos_pair_1 = float(embs[0] @ embs[1])
    cos_pair_2 = float(embs[2] @ embs[3])
    cos_mismatch_1 = float(embs[0] @ embs[3])
    cos_mismatch_2 = float(embs[1] @ embs[4])

    result = {
        "ok": True,
        "model": model_id,
        "device": device,
        "gpuName": torch.cuda.get_device_name(0) if device == "cuda" else None,
        "dimension": int(embs.shape[1]),
        "loadSeconds": load_sec,
        "encodeMs": enc_ms,
        "matchedPair1Cosine": round(cos_pair_1, 4),
        "matchedPair2Cosine": round(cos_pair_2, 4),
        "mismatchedPair1Cosine": round(cos_mismatch_1, 4),
        "mismatchedPair2Cosine": round(cos_mismatch_2, 4),
        "separationDelta": round(((cos_pair_1 + cos_pair_2) / 2) - ((cos_mismatch_1 + cos_mismatch_2) / 2), 4),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


def evaluate_chapters_payload(model, chapters: list, threshold: float):
    results = []
    for ch in chapters:
        ch_num = ch["number"]
        eng_paras = ch["engParagraphs"]
        rus_paras = ch["rusParagraphs"]
        if not eng_paras or not rus_paras:
            continue

        eng_embs = model.encode(eng_paras, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
        rus_embs = model.encode(rus_paras, batch_size=64, normalize_embeddings=True, show_progress_bar=False)

        diff = abs(len(rus_paras) - len(eng_paras))
        window = max(2, diff + 3) if diff > 0 else 0

        cosines = []
        low_pairs = []
        for idx in range(len(eng_paras)):
            if window == 0 and idx < len(rus_paras):
                best_j = idx
                score = float(eng_embs[idx] @ rus_embs[idx])
            else:
                j_start = max(0, min(idx - 3, len(rus_paras) - window - 1))
                j_end = min(len(rus_paras), max(idx + window + 1, j_start + 1))
                sims = (eng_embs[idx] @ rus_embs[j_start:j_end].T).tolist()
                best_offset = int(max(range(len(sims)), key=lambda k: sims[k]))
                best_j = j_start + best_offset
                score = float(sims[best_offset])

            cosines.append(score)
            if len(eng_paras[idx].strip()) < 18 and len(rus_paras[best_j].strip()) < 18:
                continue
            if score < threshold:
                low_pairs.append({
                    "index": idx + 1,
                    "matchedRusIndex": best_j + 1,
                    "cosine": round(score, 4),
                    "eng": eng_paras[idx][:110],
                    "rus": rus_paras[best_j][:110],
                })

        mean_cos = float(sum(cosines) / len(cosines))
        min_cos = float(min(cosines))
        results.append({
            "chapter": ch_num,
            "pairs": len(eng_paras),
            "rusCount": len(rus_paras),
            "alignmentMode": "1:1" if window == 0 else f"window(±{window})",
            "meanCosine": round(mean_cos, 4),
            "minCosine": round(min_cos, 4),
            "lowSimilarityCount": len(low_pairs),
            "lowPairs": low_pairs[:10],
        })
    return results


def run_batch_audit(model_id: str, input_path: str, threshold: float):
    with open(input_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    model, device = load_embedding_model(model_id)
    chapters = payload.get("chapters", [])
    results = evaluate_chapters_payload(model, chapters, threshold)

    out = {
        "ok": True,
        "model": model_id,
        "device": device,
        "threshold": threshold,
        "chapters": results,
    }
    print(json.dumps(out, ensure_ascii=False), flush=True)


def run_daemon(model_id: str):
    t0 = time.time()
    model, device = load_embedding_model(model_id)
    ready_msg = {
        "status": "READY",
        "model": model_id,
        "device": device,
        "pid": os.getpid(),
        "loadMs": round((time.time() - t0) * 1000, 1),
    }
    sys.stdout.write(json.dumps(ready_msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = ""
        try:
            req = json.loads(line)
            req_id = req.get("id", "")
            cmd = req.get("cmd", "embed")
            if cmd == "exit":
                break
            elif cmd == "ping":
                res = {"id": req_id, "ok": True, "device": device, "pid": os.getpid()}
            elif cmd == "audit_chapters":
                threshold = float(req.get("threshold", 0.55))
                chapters = req.get("chapters", [])
                ch_results = evaluate_chapters_payload(model, chapters, threshold)
                res = {
                    "id": req_id,
                    "ok": True,
                    "model": model_id,
                    "device": device,
                    "threshold": threshold,
                    "chapters": ch_results,
                }
            else:
                texts = req.get("texts", [])
                embs = model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
                res = {
                    "id": req_id,
                    "ok": True,
                    "model": model_id,
                    "device": device,
                    "embeddings": embs.tolist(),
                }
        except torch.cuda.OutOfMemoryError:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            res = {"id": req_id, "ok": False, "error": "CUDA_OOM"}
        except Exception as exc:
            res = {"id": req_id, "ok": False, "error": str(exc)}

        sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="google/embeddinggemma-2")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--daemon", action="store_true")
    parser.add_argument("--input", default="")
    parser.add_argument("--threshold", type=float, default=0.55)
    args = parser.parse_args()

    if args.self_test:
        run_self_test(args.model)
    elif args.daemon:
        run_daemon(args.model)
    elif args.input:
        run_batch_audit(args.model, args.input, args.threshold)
    else:
        raw = sys.stdin.read().strip()
        if not raw:
            sys.exit(0)
        req = json.loads(raw)
        texts = req.get("texts", [])
        model, device = load_embedding_model(req.get("model", args.model))
        embs = model.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
        print(json.dumps({"ok": True, "device": device, "embeddings": embs.tolist()}))


if __name__ == "__main__":
    main()
