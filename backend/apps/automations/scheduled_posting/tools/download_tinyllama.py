import os
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_NAME = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
MODEL_DIR = "./tinyllama_model"

def download_tinyllama():
    if not os.path.exists(MODEL_DIR):
        os.makedirs(MODEL_DIR)
    print(f"Baixando o modelo {MODEL_NAME} para {MODEL_DIR}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(MODEL_NAME)
    tokenizer.save_pretrained(MODEL_DIR)
    model.save_pretrained(MODEL_DIR)
    print("Download concluído.")

if __name__ == "__main__":
    download_tinyllama()
