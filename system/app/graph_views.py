"""Presentation projections only: retain original IDs, facts and evidence."""
import json
from pathlib import Path

RELATIONS = {'depends_on': '依赖', 'uses': '使用', 'purchased': '购买', 'has_feedback': '收到反馈',
             'has_participant': '参与者', 'affects': '影响', 'reported_cause': '报告的原因',
             'followed_by': '后续事件', 'may_cause': '可能导致', 'shares_identifier_with': '共享标识',
             'sister_product': '姊妹产品', 'version_of': '对应版本', 'replaced_by': '被替代为',
             'merged_into': '功能并入', 'supports': '支持', 'upgraded_to': '升级为', 'attribute': '属性'}
TYPES = {'Product': '产品', 'AITool': 'AI 工具', 'Actor': '客户与参与者', 'Version': '版本',
         'Event': '运营事件', 'DataAsset': '数据资产', 'Observation': '观测事实'}


def entity_network(graph):
    """The subject view excludes event participation hubs and keeps business relations."""
    nodes = {n['id']: n for n in graph['nodes'] if n['type'] in {'Product', 'AITool', 'Actor', 'Version'}
             and n['name'].strip() not in {'', '—', '-', '/', 'N/A'}}
    predicates = {'depends_on', 'uses', 'purchased', 'sister_product', 'version_of', 'replaced_by',
                  'merged_into', 'supports', 'upgraded_to', 'shares_identifier_with'}
    edges = [e for e in graph['edges'] if e['predicate'] in predicates and e['source'] in nodes and e['target'] in nodes]
    image_ids = {e['evidence_id'] for e in graph['evidence'] if Path(e.get('source', '')).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}}
    image_tools = {n['id'] for n in nodes.values() if n['type'] == 'AITool' and
                   any(image_ids.intersection(c.get('evidence_ids', [])) for c in n.get('attribute_claims', []))}
    if image_tools:
        # A cross-format tool inventory is stronger than a metric accidentally typed as a tool.
        nodes = {i: n for i, n in nodes.items() if n['type'] != 'AITool' or i in image_tools}
        edges = [e for e in edges if e['source'] in nodes and e['target'] in nodes]
    selected = {i for e in edges for i in (e['source'], e['target'])}
    selected.update(n['id'] for n in nodes.values() if n['type'] in {'Product', 'AITool'} and
                    any(image_ids.intersection(c.get('evidence_ids', [])) for c in n.get('attribute_claims', [])))
    return {'nodes': [n for i, n in nodes.items() if i in selected], 'edges': edges, 'layout': 'network',
            'view_note': '仅展示资料里的产品、工具、客户与版本；运营事件可在全部抽取结果中查看。'}


def mindmap_html(project, graph, evidence, images=None):
    network = entity_network(graph)
    payload = {'name': project['name'], 'nodes': network['nodes'], 'edges': network['edges'],
               'facts': graph['facts'], 'evidence': evidence, 'documents': graph['documents'],
               'relations': RELATIONS, 'types': TYPES, 'images': images or {}}
    data = json.dumps(payload, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    template = Path(__file__).with_name('mindmap.html').read_text(encoding='utf-8')
    return template.replace('__GRAPH_DATA__', data)
