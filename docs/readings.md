# Readings

An experiment reads its photographs as numbers: how many individuals a unit
holds on a given day. This document defines where each part of that reading
lives.

## What a model declares

A model declares the classes it recognizes and nothing else. Classes are the
model's identity: the image page offers them as the class of a new box, the
YOLO export indexes labels by them, dataset transfer requires both ends to
agree on them, and a training snapshot freezes them alongside the images.

The built-in seed germination model recognizes `ungerminated` and
`germinated`, two states of one seed. Every visible seed is boxed in one of
them, so a photograph annotated for it teaches the model both what a seed is
and which state it is in. Seeds hidden under grown seedlings go unboxed, since
nothing in the photograph shows them.

A model is the question, not the machine that answers it. It exists as soon as
someone names it, with no version at all. Its images are then read by a
reviewer, and those reviews are what a first version is eventually trained on.

## What an observation declares

An observation declares the date it was made, the model its photographs are
read for, and which of that model's classes the day counts. Which version has
read an image is recorded with that image's detection, and the version that
reads for a model is the one a person made current: a model with none leaves
its images for a reviewer, a newly trained version waits as a candidate until
someone chooses it, and choosing another version reads them all afresh.

What a day counts is the experiment's question, not the model's. A germination
trial photographs its dishes before anything has germinated and counts every
seed, `ungerminated` and `germinated` alike; later days count `germinated`
alone, since grown seedlings hide the seeds that have not germinated and the
photograph no longer shows them all. A day counts every class its model
recognizes unless it names fewer, and it always counts at least one.

## Where the numbers come from

Every photograph yields a tally: how many instances of each class the reading
found. An image can hold three readings, and they rank: a reviewer's
review outranks an AI agent's proposal, which outranks the detector's
result. A unit's tally is the best reading its photograph has. A proposal
counts because an agent that sees the photograph reads it better than the
detector, but it is still a machine's reading; only a review marks the
image reviewed, and the grid shows the difference.

**A count** is how many instances of the classes its day counts a unit's
reading found. The tally keeps every class whatever the day counts, so changing
the classes recounts the same readings, and nothing is read again.

## What the grid shows

A row is a unit, beside the treatment it belongs to. A column is the day. Under
the date it names the model only when the days do not all read for the same
one, and the classes it counts only when they are fewer than its model
recognizes. A cell shows the unit's count.

## What the spreadsheet carries

An experiment exports as one sheet. The block at the top names the experiment,
its plant material, explant type and base medium, the day it was inoculated and
the day the file was taken. Below that the design repeats down every row —
treatment, factor, unit — so the table sorts, filters and pivots on it, and each
observation heads the column of counts it read, one row per unit. Under its date
a day names its model, and the classes it counts when they are fewer than the
model recognizes.

Quantities stay quantities and days stay days. A count is a number, and a day is
the day a spreadsheet counts rather than the text of one, so whatever opens the
file can sort, chart and compute on it. The sheet records what the dish did
rather than what the workbench is doing: a reading still to come leaves its
cell empty, and a unit an event took out of the analysis carries the name of
that event where its number would be.

## Culture events

A culture event decides whether a unit's reading enters an analysis:
contaminated, discarded, and missing exclude the unit from the observation that
records the event onwards. Nonviable does not exclude a unit. Harvested keeps
it included on the recorded observation and excludes it from later ones, when
the unit has left the bench. An excluded unit contributes to no treatment summary.
