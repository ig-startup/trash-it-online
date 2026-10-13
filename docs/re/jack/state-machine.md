# Jack's state machine — **Confirmed**

Jack is not a handful of flags. He is **46 states and 174 transitions**,
each state a function, and the clone's player logic — written from the
outside in, by guessing at what the animations implied — is where every
animation complaint from play-testing came from.

An entity's current state lives at `+0x10`, and switching is always the
same pair:

    mov edx, <state function>
    call 0x21d30          # set_state(entity in eax, routine in edx)

A state announces its animation the same way, `mov eax, <slot>` then
`call 0x21c26`, and the slot indexes the table `anims.py` already reads
and that play-testing already named. So each state can be named by what
Jack looks like while he is in it.

Two states are hubs: **0x22892**, which 19 transitions lead to and which
sets animation slot 1 — the single standing frame, so it is simply
*standing* — and **0x256e9** with 29. Everything comes back to one of them.

With the slot numbering corrected (see the animation table) the graph
reads as one coherent machine rather than a scatter of names:

| state | slot | what |
|---|---|---|
| 0x22892 | 1 | standing — the hub |
| 0x22275 | 0 | running (cycle A) — `xor eax, eax` before `play_anim`, which is why `states.py` sees no slot |
| 0x236b9 | 3 | walking (cycle B), at profile 0's 1.53 px/tick; the hammer key from here enters the windup |
| 0x2266d | 2 | skidding to a halt |
| 0x23a27 | 6 | **hammer windup** — charges while the key is held (not found by `states.py`: its slot is a constant, but it is entered by `mov edx, 0x23a27` from three places) |
| 0x23cef | 15+charge | **hammer strike** — computed slot, which is why `states.py` cannot name it |
| 0x25813 | 31 | in the air — horizontal air control lives here (VA 0x2582d-0x25909) |
| 0x25a3e | 32 | hitting the ground |
| 0x24346 → 0x24727 → 0x2498a | 12, 22, 23 | duck into the hard hat → hat, still → hat, moving |
| 0x244c0 | 13 | come back up out of the hat → standing |
| 0x25bda → 0x299b6 | 33, 60 | climbing a ladder → topping out onto the platform |
| 0x25dfc → 0x26167 | 34, 35 | a long fall, two parts |
| 0x29828 | 58 | hard landing and get up |
| 0x2820b | 38 | pushing something along |
| 0x29072 | 55 | air roll |

`scripts/formats/states.py` extracts the whole graph, and will draw it
with `--dot`.

The note that used to stand here — *"the hard-hat animations belong to no
state"* — was an artefact of the slot offset. They belong to three states
(0x24346, 0x24727, 0x2498a, plus 0x244c0 to leave), and the hat is a
mode in the sense that those states loop among themselves until Jack
comes back out.
