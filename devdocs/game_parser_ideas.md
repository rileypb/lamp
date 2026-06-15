```
action take:
	item taken
	syntax: 
		"take [taken]",
		"get [taken]",
		"pick up [taken]",
		"pick [taken] up"

on action take:
	self.taken.holder = player
```