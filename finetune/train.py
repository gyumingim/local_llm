"""
QLoRA 파인튜닝 (파인튜닝 실험) — Unsloth
작은 모델(Qwen2.5-Coder-0.5B-Instruct) + self-instruct 데이터
⚠️ 자기생성 데이터라 성능↑ 기대 낮음 — 파이프라인 실증 + "향상 없음" 확인 목적
실행: python finetune/train.py
"""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "ft_data.jsonl")


def main():
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import SFTTrainer, SFTConfig

    model, tok = FastLanguageModel.from_pretrained(
        model_name="unsloth/Qwen2.5-Coder-0.5B-Instruct",
        max_seq_length=2048,
        load_in_4bit=True,
    )
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
    )

    rows = [json.loads(l) for l in open(DATA, encoding="utf-8")]

    def fmt(ex):
        return f"### Instruction:\n{ex['instruction']}\n\n### Response:\n{ex['output']}{tok.eos_token}"

    ds = Dataset.from_list([{"text": fmt(r)} for r in rows])

    trainer = SFTTrainer(
        model=model, tokenizer=tok, train_dataset=ds,
        args=SFTConfig(
            per_device_train_batch_size=1, gradient_accumulation_steps=4,
            max_steps=30, learning_rate=2e-4, warmup_steps=5,
            logging_steps=5, output_dir=os.path.join(BASE, "out"),
            dataset_text_field="text", max_seq_length=2048,
        ),
    )
    trainer.train()

    # Ollama에서 쓸 수 있게 GGUF export
    model.save_pretrained_gguf(os.path.join(BASE, "model_ft"), tok, quantization_method="q4_k_m")
    print("saved GGUF -> finetune/model_ft (ollama create 로 등록 가능)")


if __name__ == "__main__":
    main()
