from worker import classify

def test_classify():
    assert classify("oi") == "saudacao"
    assert classify("quero status do pedido") == "pedido_status"
    assert classify("") == "fallback"
