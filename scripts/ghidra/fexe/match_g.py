"""
F.EXE routines that are G.EXE's own code: each unnamed F routine (8+
lines) against every G routine named by hand, by difflib on the
decompilation with names, numbers and variables blanked. Prints the
pairs at 0.8 or better; read each pair side by side before taking the name.

    python3 scripts/ghidra/fexe/match_g.py      # ~30 s
"""
import sys,re,difflib
sys.argv=['x']
sys.path.insert(0, __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..'))
import fn
def norm(b):
    b=b.split('{',1)[-1]
    b=re.sub(r'/\*.*?\*/','',b,flags=re.S)
    b=re.sub(r'\b(FUN|DAT|PTR|LAB|SUB|_DAT|s)_[0-9A-Za-z_]+','X',b)
    b=re.sub(r'\b[a-z]Var\d+|\bin_[A-Z]+|\bextraout_\w+|\bparam_\d+|\bunaff_\w+|\blocal_\w+|\bauStack_\w+','v',b)
    b=re.sub(r'0x[0-9a-f]+|\b\d+\b','N',b)
    return re.findall(r'\w+|[^\s\w]',b)
g=fn.Decomp(raw=True)  # G, raw
gnamed=fn.hand_named()
G=[(a,g.name[a],norm(g.bodies[a][1])) for a in gnamed if a in g.bodies and g.bodies[a][1].count('\n')>=8]
fn.use_fexe(); f=fn.Decomp(raw=True); fnamed=fn.hand_named()
hi=0x55560
res=[]
for a in sorted(f.bodies):
    if a>=hi or a in fnamed or fn.is_data(f,a): continue
    n=f.bodies[a][1].count('\n')
    if n<8: continue
    t=norm(f.bodies[a][1])
    best=(0,None)
    for ga,gn,gt in G:
        if abs(len(gt)-len(t))>0.3*max(len(t),1): continue
        sm=difflib.SequenceMatcher(None,t,gt,autojunk=False)
        if sm.real_quick_ratio()<best[0] or sm.quick_ratio()<best[0]: continue
        r=sm.ratio()
        if r>best[0]: best=(r,(ga,gn))
    if best[0]>=0.8: res.append((best[0],a,n,best[1]))
for r,a,n,(ga,gn) in sorted(res,key=lambda x:x[1]):
    print("0x%05x %4d  %.2f  G %s @ 0x%x"%(a,n,r,gn,ga))
