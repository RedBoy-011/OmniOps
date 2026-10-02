"""First local-only routing policy shared by web, Windows and OpenAI-compatible calls."""

from .ollama import LocalModel


def choose_local_chat_model(models: tuple[LocalModel, ...], requested: str, prompt: str) -> str:
    index = {f'ollama/{item.name}': item.name for item in models}
    if requested != 'auto':
        if requested not in index:
            raise ValueError('Requested local chat model is not installed or cannot chat')
        return index[requested]
    if not models:
        raise ValueError('No local chat model is installed')
    # Matn-e kootah model-e kam-masraf, matn-e boland model-e bozorgtar ra migirad.
    ranked = sorted(models, key=lambda item: (item.size_bytes or 0, item.name))
    return (ranked[0] if len(prompt) <= 240 else ranked[-1]).name
