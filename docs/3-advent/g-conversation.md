# Conversation

Conversation style is a matter of taste, so it ships as an opt-in
library. Import it after advent:

```lamp
lib advent
lib conversation
```

It provides the classic ASK/TELL model: greeting steers the player toward
topics, topics carry replies, and free-text SAY catches fixed utterances.

## Greeting

`talk to X`, `greet X`, `say hello to X` run the `greet` action, whose
default nudges the player onward ("The butler waits for you to say
something."). Give an NPC a real opening:

```lamp
instead greet when self.interlocutor == butler:
    print "The butler inclines his head. 'Madam?'[line break]"
    stop succeeded
```

Bare `hello` gets a cheeky default reply; `butler, hello` routes to
`greet butler`.

## Topics: ASK and TELL

A **subject** is a topic object — nameable, with vocabulary and a reply,
but not physical, so it resolves globally (you can ask about the weather
from anywhere):

```lamp
subject weather_topic:
    understand "weather/rain"
    reply "'Frightful, madam,' the butler says."
```

`ask butler about weather` prints the subject's `reply`; a topic with no
reply gets the puzzled default ("The butler has nothing to say about
that."). `tell X about Y` is the same shape with a neutral default. The
topic slot also accepts **physical objects** — `ask butler about
moonstone` works without declaring a subject; since things carry no
`reply`, answer with rules:

```lamp
instead ask when self.interlocutor == butler and self.topic == moonstone:
    print "'I couldn't say, madam.' His eyes flick to the cabinet.[line break]"
    stop succeeded
```

Guard on `self.interlocutor` for per-NPC answers, on scenes or globals
for evolving ones. Topic data lives on subjects and in rules — there is
no separate conversation-table structure to maintain.

## Free text: SAY and ANSWER

`say [anything]` / `answer [anything]` capture the player's words
verbatim (lowercased) in a string slot — for passwords, yes/no answers,
and asserted phrases:

```lamp
instead say when self.topic == "yes" and holder(guard) == holder(player):
    print "'Good,' the guard grunts.[line break]"
    stop succeeded
```

Unhandled utterances fall to "There is no reply." The listener isn't a
slot — gate on who's present. The addressed form `guard, friend` (a
remainder that parses as no command) also arrives as `say`, with
`self.interlocutor` set to the addressee.

## Asking for things

`ask X for Y` lives in core advent beside GIVE and SHOW — the economy
verbs. It fails politely by default; a handover is your rule:

```lamp
instead ask_for when self.interlocutor == butler and self.requested == tray:
    print "'Of course, madam.' He proffers the tray.[line break]"
    move tray to player
    stop succeeded
```

An NPC's carried items are in scope, so `ask butler for tray` resolves
naturally. The request is by voice, not touch — it works through a glass
booth; whether the NPC complies is your story.

## The shape of an NPC

Everything composes fail-soft — each piece optional, sensible defaults
without any of them:

```lamp
person butler

instead greet when self.interlocutor == butler: ...   # an opening
subject weather_topic: ...                             # topics with replies
instead ask when self.topic == moonstone: ...          # dynamic answers
rule persuasion_rules when p == butler: ...            # takes orders
instead ask_for when self.requested == tray: ...       # hands things over
```

---

Next: [Scoring](h-scoring.md).
