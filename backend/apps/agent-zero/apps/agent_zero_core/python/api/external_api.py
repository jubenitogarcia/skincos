from python.helpers.api import ApiHandler
from flask import Request, Response
from agent import AgentContext, UserMessage
from python.helpers.print_style import PrintStyle


class ExternalApi(ApiHandler):
    """
    Endpoint para comunicação externa com o Agent Zero
    Permite enviar mensagens diretamente via HTTP sem autenticação
    """

    @classmethod
    def requires_auth(cls) -> bool:
        return False

    @classmethod
    def requires_csrf(cls) -> bool:
        return False

    @classmethod
    def requires_api_key(cls) -> bool:
        return True  # Requer API key para segurança

    @classmethod
    def get_methods(cls) -> list[str]:
        return ["POST"]

    async def process(self, input: dict, request: Request) -> dict | Response:
        try:
            # Extrair dados da requisição
            message = input.get("message", "")
            context_id = input.get("context", "default")

            if not message:
                return {
                    "success": False,
                    "error": "Message is required"
                }

            # Log da mensagem recebida
            PrintStyle(
                background_color="#6C3483", font_color="white", bold=True, padding=True
            ).print(f"External API message received:")
            PrintStyle(font_color="white", padding=False).print(f"> {message}")

            # Obter contexto do agente
            context = self.get_context(context_id)

            # Criar e enviar mensagem para o agente
            task = context.communicate(UserMessage(message, []))

            # Para API externa, vamos retornar imediatamente o status
            # sem esperar a conclusão completa (assíncrono)
            return {
                "success": True,
                "message": "Message sent to agent",
                "context": context.id,
                "status": "processing"
            }

        except Exception as e:
            PrintStyle().error(f"External API error: {str(e)}")
            return {
                "success": False,
                "error": str(e)
            }
