#!/bin/bash

echo "========================================"
echo "  🔧 Corrigindo instalação - Scheduled Posting"
echo "========================================"
echo ""

# Ativar ambiente virtual
source .venv/bin/activate

# 1. Corrigir problema do sentencepiece (necessário para T5)
echo "📋 Instalando dependências do sistema para sentencepiece..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v brew &> /dev/null; then
        brew install cmake pkg-config
    else
        echo "⚠️  Homebrew não encontrado. Instale com:"
        echo "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    fi
fi

# 2. Instalar sentencepiece via conda ou compilar manualmente
echo "📋 Tentando instalar sentencepiece..."
pip install sentencepiece --no-requirements || {
    echo "📋 Instalando via wheel pré-compilado..."
    pip install https://github.com/google/sentencepiece/releases/download/v0.2.0/sentencepiece-0.2.0-cp313-cp313-macosx_11_0_arm64.whl 2>/dev/null || {
        echo "📋 Usando protobuf como alternativa..."
        pip install protobuf
    }
}

# 3. Atualizar requirements.txt com versões compatíveis
echo "📋 Atualizando requirements.txt..."
cat > requirements_free.txt << 'EOF'
# Core dependencies
torch>=2.0.0
torchvision
torchaudio
numpy
pillow
moviepy
opencv-python
tqdm

# Whisper for audio transcription
faster-whisper

# Vision models
transformers>=4.36.0
accelerate
safetensors

# Alternative tokenizers (if sentencepiece fails)
tiktoken
protobuf

# Utilities
matplotlib
requests
pyyaml
EOF

# 4. Instalar pacotes alternativos
echo "📋 Instalando pacotes alternativos..."
pip install tiktoken protobuf

echo ""
echo "========================================"
echo "  ✅ Correções aplicadas!"
echo "========================================"
