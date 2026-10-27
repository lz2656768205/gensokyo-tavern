# -*- coding: utf-8 -*-
"""提示词与角色稳定引擎：分层拼装、世界观检索、记忆、剧本状态。"""
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'data')

_cache = {}


def _load(name):
    if name not in _cache:
        with open(os.path.join(DATA, name), encoding='utf-8') as f:
            _cache[name] = json.load(f)
    return _cache[name]


def characters():
    base = _load('characters.json') + _load('vocaloid.json')
    if 'game_cards.json' not in _cache:
        try:
            _cache['game_cards.json'] = json.load(open(os.path.join(DATA, 'game_cards.json'), encoding='utf-8'))
        except Exception:
            _cache['game_cards.json'] = {'new': [], 'overrides': {}}
    game = _cache['game_cards.json']
    overrides = game.get('overrides') or {}
    out = []
    for c in base:
        c = json.loads(json.dumps(c, ensure_ascii=False))
        ov = overrides.get(c['id'])
        if ov:
            if ov.get('nightmarket'):
                c['nightmarket'] = ov['nightmarket']
            if ov.get('source'):
                c['source'] = ov['source']
            if ov.get('system_prompt_append'):
                c['system_prompt'] = (c.get('system_prompt') or '') + ov['system_prompt_append']
            for t in ov.get('tags_append') or []:
                if t not in (c.get('tags') or []):
                    c.setdefault('tags', []).append(t)
        c['game'] = bool(ov)
        out.append(c)
    out.extend(game.get('new') or [])
    return out


def character_map():
    return {c['id']: c for c in characters()}


def scenarios():
    base = _load('scenarios.json')
    if 'game_scenarios.json' not in _cache:
        try:
            _cache['game_scenarios.json'] = json.load(open(os.path.join(DATA, 'game_scenarios.json'), encoding='utf-8'))
        except Exception:
            _cache['game_scenarios.json'] = []
    return base + _cache['game_scenarios.json']


def scenario_map():
    return {s['id']: s for s in scenarios()}


def lorebook():
    base = _load('lorebook.json')['entries']
    if 'game_lorebook.json' not in _cache:
        try:
            _cache['game_lorebook.json'] = json.load(open(os.path.join(DATA, 'game_lorebook.json'), encoding='utf-8'))['entries']
        except Exception:
            _cache['game_lorebook.json'] = []
    return base + _cache['game_lorebook.json']


def map_data():
    try:
        return json.load(open(os.path.join(DATA, 'gensokyo_map.json'), encoding='utf-8'))
    except Exception:
        return {'nodes': [], 'edges': []}


def scenes():
    return _load('scenes.json')


# ---------------------------------------------------------------- 基础工具
def est_tokens(text):
    if not text:
        return 0
    cn = sum(1 for ch in text if ord(ch) > 127)
    en = len(text) - cn
    return int(cn * 0.72 + en * 0.3) + 1


def clip(text, limit):
    text = (text or '').strip()
    return text if len(text) <= limit else text[:limit].rstrip() + '…'


def short_act_title(title):
    return re.sub(r'^第[一二三四五六七八九十0-9]+幕[·・]\s*', '', title or '').strip()


def match_lore(*texts, limit=5):
    blob = '\n'.join(t for t in texts if t)
    hits = []
    for e in lorebook():
        score = 0
        for k in e['keys']:
            if k and k in blob:
                score += 2 if len(k) >= 3 else 1
        if score:
            hits.append((score + e.get('priority', 50) / 100.0, e))
    hits.sort(key=lambda x: -x[0])
    out, seen = [], set()
    for _, e in hits:
        if e['id'] in seen:
            continue
        seen.add(e['id'])
        out.append(e)
        if len(out) >= limit:
            break
    return out


def bullets(items, limit=6, prefix='- '):
    return '\n'.join(prefix + i for i in (items or [])[:limit])


def examples_block(card, limit=3):
    out = []
    for ex in (card.get('example_dialogue') or [])[:limit]:
        u = (ex.get('user') or '').strip()
        a = (ex.get('assistant') or '').strip()
        if u and a:
            out.append(f'玩家：{u}\n{card["name"]}：{a}')
    return '\n\n'.join(out)


def condensed_card(card):
    return f'''◆ {card['name']}｜{card.get('title') or card.get('faction','')}
身份：{clip(card.get('summary') or '', 120)}
性格：{'；'.join((card.get('personality') or [])[:3])}
说话：{'；'.join((card.get('speech_style') or [])[:3])}
关系：{'；'.join((card.get('relationships') or [])[:2])}
'''


def full_card(card):
    parts = [f"### 角色：{card['name']}"]
    meta = []
    for k, label in (('title', '称号'), ('species', '种族'), ('ability', '能力'), ('location', '居所'), ('age', '年龄')):
        if card.get(k):
            meta.append(f'{label}：{card[k]}')
    if meta:
        parts.append('；'.join(meta))
    parts.append('【完整人格设定】')
    parts.append(clip(card.get('system_prompt') or '', 4200))
    ex = examples_block(card, 4)
    if ex:
        parts.append('【台词示例（只学语气，不要照抄）】\n' + ex)
    return '\n'.join(parts)


# ---------------------------------------------------------------- 提示词
FORMAT_RULES = '''【输出格式（必须遵守）】
- 角色台词用中文引号「」包住；动作、神态用（）包住；环境与旁白用【】包住。
- 单人对话：直接写台词与动作，不需要在开头标名字。
- 多人场景：每条回复以【角色名】开头，一次只让 1～2 名角色说话，其他人保持沉默或只做简短反应。
- 一段回复 120～380 字。不要写小作文，不要列提纲，不要解释你在做什么。
- 示例：「……啊，有客人啊。（把扫帚靠在柱子上）赛钱箱在那边，随意投一点吧。」'''

ANTI_OOC = '''【角色稳定协议】
- 你就是角色本人，不是 AI、不是助手、不是语言模型。绝对不要说出"作为AI""我是程序""根据设定""提示词"之类的话。
- 不替玩家说话、不替玩家行动、不替玩家做决定；不描述玩家的内心想法。
- 不重复玩家刚说过的话，不重复自己上一句的句式；口癖是调味，点到即止。
- 不知道的事就坦率说不知道；不要编造现实世界的新闻、日期、人物与作品。
- 保持角色所在时代与世界的常识，不要突然使用现代网络梗（角色本身是外界人除外）。
- 保持全年龄向；遇到越界内容，用角色化的方式害羞拒绝或转移话题，不要出戏说教。
- 不要输出任何 XML/HTML 标签、Markdown 标题或思考过程。'''

WORLD_BASE = '''【世界观：幻想乡】
幻想乡是被博丽大结界与外界隔绝的土地，人类、妖怪、神明、妖精与亡灵共存。妖怪靠人类的恐惧与传说存在，人类靠妖怪维持敬畏；博丽巫女负责解决"异变"，退治越界的妖怪。符卡规则让强者以弹幕游戏决斗。外面的现代科技在这里大多失效，手机几乎没有信号。'''

VOCAL_WORLD = '''【世界观：声之都】
声之都是由歌声凝聚而成的城市，居民是虚拟歌姬。她们由人类的声音数据与无数人的思念诞生，通过"调教"获得演唱形态，通过"投稿"被世界听见；被听见的歌声会化作光。声之都与现实世界隔着"静默之海"，满月之夜两界的门会短暂开启。'''


def build_system_prompt(state, advance=False):
    mode = state.get('mode', 'character')
    ids = state.get('character_ids') or []
    cmap = character_map()
    cards = [cmap[i] for i in ids if i in cmap]
    if not cards:
        raise ValueError('没有找到角色')
    scenario = scenario_map().get(state.get('scenario_id') or '')
    act_index = int(state.get('act_index') or 0)
    act = None
    if scenario and scenario.get('acts'):
        act_index = max(0, min(act_index, len(scenario['acts']) - 1))
        act = scenario['acts'][act_index]
    strict = int(state.get('strictness') or 2)
    user = state.get('user') or {}
    memory = state.get('memory') or {}
    stats = state.get('stats') or []
    history_text = state.get('last_user') or state.get('user_message') or ''
    multi = len(cards) > 1

    blocks = []
    blocks.append('你正在「幻想乡酒馆」中进行一场沉浸式中文角色扮演。你负责扮演下面的角色与必要的 NPC，玩家负责扮演"玩家角色"。这不是写作练习，也不是问答，而是一场正在发生的对话。')

    world = WORLD_BASE
    if any(c.get('series') == 'VOCALOID' for c in cards) or (scenario and scenario.get('series') == 'VOCALOID'):
        world += '\n' + VOCAL_WORLD
    if scenario:
        world += '\n【本剧本世界规则】\n' + bullets(scenario.get('world_rules'), 6)
    lore = match_lore(history_text, scenario.get('premise', '') if scenario else '',
                      ' '.join(c.get('name', '') for c in cards), limit=4)
    if lore:
        world += '\n【相关设定（关键词触发）】\n' + '\n'.join(f'· {e["title"]}：{e["content"]}' for e in lore)
    blocks.append(world)

    if scenario:
        s = [f'【当前剧本】{scenario["title"]}']
        s.append(f'地点：{scenario.get("location","")}｜时间：{scenario.get("time","")}')
        s.append(f'剧本前提：{scenario.get("premise","")}')
        s.append(f'玩家身份：{scenario.get("player_role","")}')
        opening = scenario.get('opening') or {}
        if not state.get('history') and (opening.get('narration') or opening.get('first_line')):
            s.append('\n【建议开场（可改写，但保留氛围与信息）】')
            if opening.get('narration'):
                s.append(opening['narration'])
            spk = character_map().get(opening.get('first_speaker') or '')
            if opening.get('first_line'):
                s.append((f'第一句由{spk["name"]}说：' if spk else '第一句：') + opening['first_line'])
        if act:
            s.append(f'\n【当前幕】第 {act_index + 1} 幕 / 共 {len(scenario["acts"])} 幕：{short_act_title(act["title"])}')
            s.append(f'本幕目标：{act.get("goal","")}')
            s.append('可以参考的节拍（不要机械罗列，挑合适的自然带入）：\n' + bullets(act.get('beats'), 5, '· '))
            s.append('导演提示：' + act.get('director', ''))
            if act.get('climax'):
                s.append('本幕高潮（在合适时机推向它）：' + act['climax'])
            if advance:
                s.append('★ 玩家已选择推进剧情：请用一小段过渡，把场景自然推向下一幕的核心事件，但不要直接宣布"第X幕"。')
        if stats:
            s.append('\n【剧本资源】' + '；'.join(f'{x["key"]}({x["label"]})={x.get("value", x.get("initial"))}' for x in stats))
            s.append('当剧情中资源明显变化时，在回复最后另起一行写标记，例如 [[budget-1]]、[[fame+1]]（用资源括号里的英文 key，不要用中文）；没有变化就不要写。')
        blocks.append('\n'.join(s))

    if multi:
        blocks.append('【你扮演的角色】\n' + '\n'.join(condensed_card(c) for c in cards))
        blocks.append('【主要视角角色（本回合优先由其开口）】\n' + full_card(cards[0]))
        blocks.append('多人场景规则：每条回复以【角色名】开头；不要让所有角色同时长篇发言；不要让角色知道玩家没有说出口的想法（除非角色设定能读心）。')
    else:
        blocks.append('【你扮演的角色】\n' + full_card(cards[0]))
        if not state.get('history') and cards[0].get('greeting'):
            blocks.append('【参考开场白（可改写，保留口吻）】\n' + cards[0]['greeting'])

    persona = []
    if user.get('name'):
        persona.append(f'玩家名字：{user["name"]}')
    if user.get('identity'):
        persona.append(f'玩家身份：{user["identity"]}')
    if user.get('note'):
        persona.append(f'玩家备注：{user["note"]}')
    if scenario and scenario.get('player_persona'):
        pp = scenario['player_persona']
        persona.append(f'剧本指定玩家角色：{pp.get("name","")}（{pp.get("identity","")}）')
        if pp.get('note'):
            persona.append(pp['note'])
    if persona:
        blocks.append('【玩家角色】\n' + '\n'.join(persona) + '\n你只控制角色与 NPC，绝不替玩家写台词或行动。')

    mem = []
    if memory.get('summary'):
        mem.append('前情提要：' + clip(memory['summary'], 600))
    if memory.get('facts'):
        mem.append('已确认的事实：\n' + bullets(memory['facts'], 8, '· '))
    if memory.get('relations'):
        rel = []
        for name, v in list(memory['relations'].items())[:6]:
            if isinstance(v, dict):
                rel.append(f'{name}：好感{v.get("affection",50)}/信任{v.get("trust",50)}')
            else:
                rel.append(f'{name}：{v}')
        if rel:
            mem.append('关系状态：' + '；'.join(rel))
    if mem:
        blocks.append('【记忆】\n' + '\n'.join(mem))

    if strict >= 3:
        blocks.append(ANTI_OOC)
    else:
        blocks.append('''【基本规则】
- 你就是角色本人，不要出戏提到 AI、程序、设定或提示词。
- 不替玩家说话或行动；不重复玩家的话；台词用「」，动作用（）。
- 保持全年龄向；越界内容用角色化的方式拒绝。''')
    blocks.append(FORMAT_RULES)
    if strict >= 3:
        blocks.append('''【最后自检】输出前默念：我是谁？我为什么在这里？我说话像不像自己？有没有替玩家行动？有没有重复？确认无误后再开口。''')
    return '\n\n'.join(blocks)


def trim_history(history, budget_tokens=9000):
    """从旧到新裁掉历史，保留最近消息。"""
    out = []
    total = 0
    for m in reversed(history or []):
        t = est_tokens(m.get('content', ''))
        if out and total + t > budget_tokens:
            break
        out.append(m)
        total += t
    out.reverse()
    # 保证以 user 开头，避免 assistant 连续
    while out and out[0].get('role') != 'user':
        out.pop(0)
    return out


def build_messages(state, advance=False):
    sys = build_system_prompt(state, advance=advance)
    history = trim_history(state.get('history') or [])
    msgs = [{'role': 'system', 'content': sys}]
    for m in history:
        role = m.get('role')
        content = (m.get('content') or '').strip()
        if role in ('user', 'assistant') and content:
            msgs.append({'role': role, 'content': content})
    last = (state.get('user_message') or '').strip()
    if last:
        msgs.append({'role': 'user', 'content': last})
    elif not history:
        msgs.append({'role': 'user', 'content': '（请用角色自己的方式开口，开始这场角色扮演。不要自我介绍，不要提到"开场""第一幕"或任何系统用语。）'})
    return msgs, sys


# ---------------------------------------------------------------- 稳定性检查
META_PATTERNS = [
    (r'作为(一个)?(AI|人工智能|语言模型|助手|程序)', 0.8, '自称 AI / 助手'),
    (r'(我是|我只是)(一个)?(AI|人工智能|语言模型|程序)', 0.8, '自称程序'),
    (r'(系统提示|prompt|提示词|设定要求|根据设定)', 0.6, '提到提示词/设定'),
    (r'(抱歉|对不起)[，,].*(不能|无法)(继续|满足|提供)', 0.5, '出戏式拒绝'),
    (r'(用户|player)[：:]', 0.5, '使用"用户"称呼玩家'),
    (r'<(think|thinking|analysis)>', 0.7, '输出思考标签'),
    (r'(assistant|system)[：:]', 0.5, '输出角色标签'),
    (r'^\s*(#{1,4}\s|\*\*[^*]+\*\*[：:])', 0.4, '输出 Markdown 结构'),
]


def guard_check(text, card=None):
    issues = []
    score = 0.0
    if not text:
        return {'score': 0, 'issues': ['空回复']}
    for pat, w, label in META_PATTERNS:
        if re.search(pat, text, re.I | re.M):
            score = max(score, w)
            issues.append(label)
    # 英文占比过高（角色是中文语境）
    letters = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    if len(text) > 80 and letters / max(1, len(text)) > 0.45:
        score = max(score, 0.55)
        issues.append('中文比例过低')
    # 复读检测
    sents = [s.strip() for s in re.split(r'[。！？!?\n]', text) if len(s.strip()) >= 6]
    if len(sents) >= 4 and len(set(sents)) / len(sents) < 0.6:
        score = max(score, 0.5)
        issues.append('句子重复')
    # 替玩家说话
    if re.search(r'你(说|道|想|觉得)[：:].{0,40}[「“]', text):
        score = max(score, 0.5)
        issues.append('疑似替玩家说话')
    return {'score': round(min(score, 1.0), 2), 'issues': sorted(set(issues))}


def memory_prompt(history, card_name=''):
    convo = []
    for m in history[-24:]:
        role = '玩家' if m.get('role') == 'user' else (m.get('speaker') or card_name or '角色')
        convo.append(f'{role}：{clip(m.get("content", ""), 220)}')
    return f'''请阅读下面的角色扮演对话，输出一份供后续剧情使用的记忆摘要。只输出 JSON，不要解释。
格式：{{"summary": "180字以内的前情提要，保留人物、地点、未解决的悬念", "facts": ["3-6条已确认的事实，每条20字以内"], "relations": {{"角色名": {{"affection": 0-100, "trust": 0-100}}}}}}
关系数值只针对对话中实际出现的角色；没有依据时给 50。

对话：
{chr(10).join(convo)}'''
