# -*- coding: utf-8 -*-
"""离线演示引擎：没有 API Key 时也能跑通剧本，保证开箱可玩。"""
import random

from engine import character_map, scenario_map


def _strip_quotes(s):
    s = (s or '').strip()
    for a, b in (('「', ''), ('」', ''), ('“', ''), ('”', '')):
        s = s.replace(a, '').replace(b, '')
    return s.strip()


def _score(text, ex_user):
    a = set(text[i:i + 2] for i in range(len(text) - 1))
    b = set(ex_user[i:i + 2] for i in range(len(ex_user) - 1))
    return len(a & b) / (len(b) + 1)


def pick_line(card, user_text, turn):
    exs = card.get('example_dialogue') or []
    if not exs:
        return card.get('greeting') or '「……」'
    best, best_score = None, -1
    for i, ex in enumerate(exs):
        sc = _score(user_text, ex.get('user') or '') - i * 0.01
        if sc > best_score:
            best, best_score = ex, sc
    if best_score <= 0:
        best = exs[turn % len(exs)]
    line = best.get('assistant') or card.get('greeting') or ''
    return line if line.startswith('「') else '「' + _strip_quotes(line) + '」'


def opening(state):
    cmap = character_map()
    cards = [cmap[i] for i in state.get('character_ids') or [] if i in cmap]
    sc = scenario_map().get(state.get('scenario_id') or '')
    if sc:
        op = sc.get('opening') or {}
        speaker = cmap.get(op.get('first_speaker'))
        text = f"【{op.get('narration','')}】\n"
        if speaker:
            text += f"【{speaker['name']}】{op.get('first_line') or speaker.get('greeting')}"
        return text
    if cards:
        c = cards[0]
        return f"【{c.get('location') or '幻想乡'}的某个角落】\n{c.get('greeting') or '「……」'}"
    return '【酒馆里很安静。】'


def reply(state):
    cmap = character_map()
    cards = [cmap[i] for i in state.get('character_ids') or [] if i in cmap]
    sc = scenario_map().get(state.get('scenario_id') or '')
    user_text = state.get('user_message') or ''
    turn = int(state.get('turn') or 0)
    if not cards:
        return '【没有人回应。】'
    if sc:
        act_index = max(0, min(int(state.get('act_index') or 0), len(sc['acts']) - 1))
        act = sc['acts'][act_index]
        beat = act['beats'][turn % len(act['beats'])] if act.get('beats') else ''
        # 找台词角色：优先节拍里提到的角色
        speaker = None
        for c in cards:
            names = {c['name'], c['name'].replace('·', ''), c['name'][:2], c['name'][-2:]}
            if any(n and n in beat for n in names):
                speaker = c
                break
        if speaker is None:
            speaker = cards[turn % len(cards)]
        lead = f"【{beat.strip('。')}。】\n" if beat else ''
        line = pick_line(speaker, user_text, turn)
        return f"{lead}【{speaker['name']}】{line}"
    c = cards[turn % len(cards)]
    line = pick_line(c, user_text, turn)
    action = ['（把手里的东西放下，看向你）', '（歪了歪头，像是在等你继续说）', '（轻轻叹了口气）', '（目光在你脸上停了一瞬）'][turn % 4]
    return f"【{c['name']}】{line}\n{action}"


def suggest(state):
    sc = scenario_map().get(state.get('scenario_id') or '')
    if sc:
        idx = max(0, min(int(state.get('act_index') or 0), len(sc['acts']) - 1))
        return (sc['acts'][idx].get('suggested') or [])[:3]
    return ['继续这个话题', '问一个更私人的问题', '把话题转到别处']
