
import os
from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader
import cloudinary.api

# Carrega variáveis do .env automaticamente
load_dotenv()

# Inicializa Cloudinary com variáveis de ambiente
cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key=os.getenv('CLOUDINARY_API_KEY'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET'),
    secure=True
)

def upload_image_to_cloudinary(file_path: str) -> str:
    """Faz upload de uma imagem local para o Cloudinary e retorna a URL pública."""
    result = cloudinary.uploader.upload(file_path, resource_type="image")
    return result['secure_url']
