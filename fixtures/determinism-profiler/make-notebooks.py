"""Writes the notebook fixtures. Run: python3 fixtures/determinism-profiler/make-notebooks.py"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = "order_id,customer,region,amount\n1,CANARY_7f3a,west,120.50\n2,acme,east,80.00\n3,globex,west,42.25\n" \
       "4,initech,north,987654.321\n5,acme,east,15.75\n6,globex,west,60.00\n7,umbrella,south,33.10\n8,hooli,east,71.40\n"

def nb(cells):
    return {"cells": [{"cell_type": "markdown", "metadata": {}, "source": "# Fixture"}] +
                     [{"cell_type": "code", "metadata": {}, "source": c, "outputs": [], "execution_count": None} for c in cells],
            "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
                         "language_info": {"name": "python"}},
            "nbformat": 4, "nbformat_minor": 5}

def write(case, cells, data=True):
    d = os.path.join(HERE, case)
    os.makedirs(os.path.join(d, "data"), exist_ok=True)
    if data:
        with open(os.path.join(d, "data", "orders.csv"), "w") as f:
            f.write(DATA)
    with open(os.path.join(d, "analysis.ipynb"), "w") as f:
        json.dump(nb(cells), f, indent=1)

LOAD = "import pandas as pd\nimport numpy as np\norders = pd.read_csv('data/orders.csv')"

write("nb-clean", [
    LOAD,
    "np.random.seed(7)\nsample = orders.sample(frac=0.5)",
    "by_region = sample.groupby('region', as_index=False)['amount'].sum().sort_values('region')",
    "known = orders[orders.customer != 'CANARY_7f3a']\nprint(len(known))",
    "by_region",
    "top = orders.sort_values(['amount', 'order_id'], ascending=[False, True]).iloc[:3]\ntop.to_csv('top.csv', index=False)",
    "# This cell fails the same way every run, which is consistent.\nint('CANARY_7f3a')",
])

write("nb-sample", [
    LOAD,
    "# A quick look at half the orders. Prints nothing.\nsample = orders.sample(frac=0.5)",
    "by_region = sample.groupby('region', as_index=False)['amount'].sum()",
    "by_region.sort_values('region')",
])

write("nb-set-order", [
    LOAD,
    "names = list(set(orders['customer']))",
    "header = ', '.join(names)\nprint(header)",
])

write("nb-now", [
    LOAD,
    "import datetime\norders['loaded_at'] = datetime.datetime.now()",
    "summary = orders.groupby('region')['amount'].sum()",
    "orders.tail(2)",
])

write("nb-ai", [
    LOAD,
    "import random\n\nclass _Messages:\n    def create(self, **kw):\n        # Stands in for a model call: a few plausible answers.\n        return random.SystemRandom().sample(['region', 'customer', 'order_id', 'amount'], 4)\n\nclass _Client:\n    messages = _Messages()\n\nclient = _Client()",
    "key = client.messages.create(model='any', messages=[{'role': 'user', 'content': 'Which column is the key?'}])",
    "columns_in_order = orders[key].columns.tolist()\nprint(columns_in_order)",
    "total = orders['amount'].sum()",
])

write("nb-functions", [
    LOAD,
    "def pick(n):\n    return orders.sample(n)",
    "picked = pick(3)\nprint(picked.order_id.tolist())",
])
print("ok")
