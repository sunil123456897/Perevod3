import argparse
import json
import os
import sys
import time

# Python's urllib/httpx stalls when ALL_PROXY uses socks5h://.
for _proxy_key in ("ALL_PROXY", "all_proxy"):
    _proxy_val = os.environ.get(_proxy_key, "")
    if _proxy_val.strip().lower().startswith(("socks5h://", "socks5://")):
        os.environ.pop(_proxy_key, None)
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import torch
from sentence_transformers import SentenceTransformer

if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_embedding_model(model_id: str = "google/embeddinggemma-2"):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    try:
        model = SentenceTransformer(
            model_id,
            trust_remote_code=True,
            device=device,
            local_files_only=True,
            model_kwargs={"dtype": dtype},
        )
    except Exception:
        model = SentenceTransformer(
            model_id,
            trust_remote_code=True,
            device=device,
            local_files_only=False,
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


from collections import OrderedDict
import hashlib


_ENG_EMB_CACHE: "OrderedDict[str, object]" = OrderedDict()
_ENG_EMB_CACHE_LIMIT = 32


def _hash_paragraphs(paragraphs: list) -> str:
    h = hashlib.sha256()
    for p in paragraphs:
        h.update(p.encode("utf-8", errors="ignore"))
        h.update(b"\x01")
    return h.hexdigest()


def _encode_eng_cached(model, eng_paras: list):
    key = _hash_paragraphs(eng_paras)
    cached = _ENG_EMB_CACHE.get(key)
    if cached is not None:
        _ENG_EMB_CACHE.move_to_end(key)
        return cached
    embs = model.encode(eng_paras, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    _ENG_EMB_CACHE[key] = embs
    if len(_ENG_EMB_CACHE) > _ENG_EMB_CACHE_LIMIT:
        _ENG_EMB_CACHE.popitem(last=False)
    return embs


def align_monotonic_dp(sim_matrix: list, reuse_penalty: float = 0.08) -> list:
    """Monotonic sequence alignment returning non-decreasing 0-based RUS indices."""
    n = len(sim_matrix)
    m = len(sim_matrix[0]) if n > 0 else 0
    if n == 0 or m == 0:
        return []

    dp_prev = [float(sim_matrix[0][j]) for j in range(m)]
    back = [[-1] * m for _ in range(n)]

    for i in range(1, n):
        dp_curr = [0.0] * m
        row = sim_matrix[i]
        best_lt_val = float("-inf")
        best_lt_j = -1
        for j in range(m):
            if j > 0 and dp_prev[j - 1] > best_lt_val:
                best_lt_val = dp_prev[j - 1]
                best_lt_j = j - 1
            same_val = dp_prev[j] - reuse_penalty
            if best_lt_j != -1 and best_lt_val >= same_val:
                dp_curr[j] = best_lt_val + float(row[j])
                back[i][j] = best_lt_j
            else:
                dp_curr[j] = same_val + float(row[j])
                back[i][j] = j
        dp_prev = dp_curr

    best_last_j = max(range(m), key=lambda j: dp_prev[j])
    path = [0] * n
    curr_j = best_last_j
    for i in range(n - 1, -1, -1):
        path[i] = curr_j
        curr_j = back[i][curr_j]
    return path


def evaluate_chapters_payload(model, chapters: list, threshold: float):
    results = []
    for ch in chapters:
        ch_num = ch["number"]
        eng_paras = ch["engParagraphs"]
        rus_paras = ch["rusParagraphs"]
        if not eng_paras or not rus_paras:
            continue

        eng_embs = _encode_eng_cached(model, eng_paras)
        rus_embs = model.encode(rus_paras, batch_size=64, normalize_embeddings=True, show_progress_bar=False)

        same_count = len(rus_paras) == len(eng_paras)
        if same_count:
            matched_indices = list(range(len(eng_paras)))
            row_scores = [float(eng_embs[idx] @ rus_embs[idx]) for idx in range(len(eng_paras))]
        else:
            sim_matrix = (eng_embs @ rus_embs.T).tolist()
            matched_indices = align_monotonic_dp(sim_matrix)
            row_scores = [float(sim_matrix[idx][matched_indices[idx]]) for idx in range(len(eng_paras))]

        cosines = []
        low_pairs = []
        pair_cosines = []
        for idx, best_j in enumerate(matched_indices):
            score = row_scores[idx]
            cosines.append(score)
            if len(eng_paras[idx].strip()) < 18 and len(rus_paras[best_j].strip()) < 18:
                continue
            rounded_score = round(score, 4)
            pair_cosines.append({
                "index": idx,
                "matchedRusIndex": best_j,
                "cosine": rounded_score,
            })
            if score < threshold:
                low_pairs.append({
                    "index": idx + 1,
                    "matchedRusIndex": best_j + 1,
                    "cosine": rounded_score,
                    "eng": eng_paras[idx][:110],
                    "rus": rus_paras[best_j][:110],
                })

        mean_cos = float(sum(cosines) / len(cosines))
        min_cos = float(min(cosines))
        results.append({
            "chapter": ch_num,
            "pairs": len(eng_paras),
            "rusCount": len(rus_paras),
            "alignmentMode": "1:1" if same_count else "monotonic-dp",
            "meanCosine": round(mean_cos, 4),
            "minCosine": round(min_cos, 4),
            "lowSimilarityCount": len(low_pairs),
            "lowPairs": low_pairs[:10],
            "pairCosines": pair_cosines,
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
