import json, sys
def run(conv=0.03, churn=0.06, growth=(0.12,0.07,0.04), start=800, label='base'):
    A = dict(arpu=0.75*15+0.25*39, team_mrr=400, team_churn=0.015, cost_lesson=0.40,
             paid_lessons=15, free_active=0.10, free_lessons=2, team_lessons=60, free_cost=0.05)
    rows=[]; free_total=0; paid=0.0; teams=0.0; cash=0; cum=0; signups=0
    for m in range(1,37):
        y=(m-1)//12
        if m<=3: signups=[300,400,500][m-1]
        elif m==4: signups=start
        else: signups*= 1+growth[y]
        free_total+=signups
        new_paid=0
        if m==4: new_paid += conv*(300+400+500)
        if m>=4: new_paid += conv*signups
        paid = paid*(1-churn) + new_paid if m>=4 else 0
        newteams = 0 if m<10 else 1 if m<=15 else 2 if m<=24 else 3 if m<=30 else 4
        teams = teams*(1-A['team_churn']) + newteams
        mrr = paid*A['arpu'] + teams*A['team_mrr']
        paid_lessons = paid*A['paid_lessons'] + teams*A['team_lessons']
        free_lessons = free_total*A['free_active']*A['free_lessons']
        lessons = paid_lessons + free_lessons
        hosting=[300,1000,2500][y]
        fees = paid*(A['arpu']*0.05+0.5) + teams*A['team_mrr']*0.03
        cogs = paid_lessons*A['cost_lesson'] + free_lessons*A['free_cost'] + hosting + fees
        heads=[4,8,12][y]; pay=[2500,3000,3500][y]
        mkt = 0 if m<4 else [3000,10000,25000][y]
        admin=[1500,3000,5000][y]
        opex = heads*pay + mkt + admin
        net = mrr - cogs - opex
        cum += net
        rows.append(dict(m=m, signups=signups, free_total=free_total, paid=paid, teams=teams, mrr=mrr, lessons=lessons, cogs=cogs, opex=opex, net=net, cum=cum))
    return rows
def summary(rows):
    out=[]
    for y in range(3):
        r=rows[y*12:(y+1)*12]
        rev=sum(x['mrr'] for x in r); cogs=sum(x['cogs'] for x in r); opex=sum(x['opex'] for x in r)
        out.append(dict(year=y+1, signups=sum(x['signups'] for x in r), free_total=r[-1]['free_total'], paid=r[-1]['paid'], teams=r[-1]['teams'], mrr=r[-1]['mrr'], arr=r[-1]['mrr']*12, revenue=rev, cogs=cogs, gm=(rev-cogs)/rev if rev else 0, opex=opex, net=rev-cogs-opex))
    low=min(x['cum'] for x in rows); be=next((x['m'] for x in rows if x['net']>0 and x['m']>6), None)
    return out, low, be
res={}
for label,kw in [('conservative',dict(conv=0.02,churn=0.08,growth=(0.09,0.05,0.03),start=600)),('base',{}),('upside',dict(conv=0.045,churn=0.05,growth=(0.14,0.08,0.05),start=1000))]:
    rows=run(**kw); s,low,be=summary(rows); res[label]=dict(years=s, low=low, breakeven=be, rows=rows)
    print(label, 'peak burn', round(low), 'breakeven month', be)
    for y in s: print('  Y%d signups %6d paid %6d teams %4d MRR %8d ARR %9d rev %9d GM %.0f%% opex %8d net %9d'%(y['year'],y['signups'],y['paid'],y['teams'],y['mrr'],y['arr'],y['revenue'],y['gm']*100,y['opex'],y['net']))
json.dump(res, open(sys.argv[1],'w'))
