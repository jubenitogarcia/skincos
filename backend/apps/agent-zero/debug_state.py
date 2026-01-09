from collections import deque
import time

# Ring buffer para últimas respostas enviadas
_replies = deque(maxlen=100)

def add_reply(data: dict):
    d = dict(data)
    d.setdefault('ts', int(time.time()))
    _replies.append(d)


def get_replies():
    return list(_replies)
