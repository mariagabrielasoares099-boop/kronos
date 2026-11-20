import json
import httpx
import pytest

from app.config import load_settings
from app.services.ollama import OllamaClient, OllamaIndisponivel, cliente_de


def client(handler):
    return OllamaClient(transport=httpx.MockTransport(handler))


def test_chat_envia_sistema_e_usuario_separados():
    vistos = {}

    def h(req):
        vistos.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "ok"}})

    assert client(h).chat([{"role": "user", "content": "oi"}], sistema="seja breve") == "ok"
    assert vistos["stream"] is False
    assert [m["role"] for m in vistos["messages"]] == ["system", "user"]


def test_gerar_retorna_resposta():
    assert client(lambda r: httpx.Response(200, json={"response": "ola"})).gerar("oi") == "ola"


def test_falhas_viram_ollama_indisponivel():
    with pytest.raises(OllamaIndisponivel):
        client(lambda r: httpx.Response(500)).gerar("oi")
    with pytest.raises(OllamaIndisponivel):
        client(lambda r: httpx.Response(200, json={"x": 1})).chat([])

    def cai(r):
        raise httpx.ConnectError("sem servidor")

    with pytest.raises(OllamaIndisponivel):
        client(cai).gerar("oi")


def test_disponivel():
    assert client(lambda r: httpx.Response(200, json={"models": []})).disponivel()
    assert not client(lambda r: httpx.Response(503)).disponivel()


def test_config_padrao_e_env():
    s = load_settings({})
    assert (s.ollama_url, s.ollama_model) == ("http://localhost:11434", "llama3.2")
    s = load_settings({"OLLAMA_URL": "http://h:1/", "OLLAMA_MODEL": "qwen2.5"})
    c = cliente_de(s)
    assert (c.base_url, c.model) == ("http://h:1", "qwen2.5")
