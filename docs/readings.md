# Readings

An experiment reads its photographs as numbers: how many individuals a unit
holds on a given day, and what share of them responded. This document defines
where each part of that calculation lives.

## What a model declares

A model declares the classes it recognizes and nothing else. Classes are the
model's identity: the annotation editor offers them as the class of a new box,
the YOLO export indexes labels by them, dataset transfer requires both ends to
agree on them, and a training snapshot freezes them alongside the images.

A model is the question, not the machine that answers it. It exists as soon as
someone names it, with no version at all. Its images are then read by a
reviewer, and those reviews are what a first version is eventually trained on.

What an experiment asks of a detection is the experiment's question, not the
detector's property. A detector returns a tally per class; reducing that tally
to one number is a choice made afterwards, by whoever is asking.

## What an observation declares

An observation declares the date it was made and the model its photographs are
read for. It does not name a version. Which version has read an image is
recorded with that image's detection, and the version that reads for a model is
its newest: a model with none leaves its images for a reviewer, and a model
trained again reads them all afresh.

## Where the numbers come from

Every photograph yields a tally: how many instances of each class the reading
found. A calibrated annotation replaces the detection it was drawn over, so a
unit's tally is its annotation when a reviewer has confirmed one and its
detection otherwise.

Two quantities derive from that tally.

**A count** is how many instances a unit's reading found, across every class it
recognizes.

**A rate** is that count over the number of individuals the unit started with.
A unit's rate on its own baseline is one by construction, so the baseline reads
counts alone.

## The baseline establishes the denominator

The number of individuals in a dish is not known when the dish is sown. It is
counted from the first photograph of it, and it is that first count, not each
day's count, that every later rate divides by.

The earliest observation of an experiment is its baseline. A unit's denominator
is the total tally of its baseline photograph, under the same annotation-over-
detection rule as any other reading. A unit with no baseline photograph has no
denominator: its counts still read, and its rates are empty. No unit borrows
another unit's denominator.

The denominator is derived on every read rather than copied into a column. A
reviewer who finds a missed individual in the baseline photograph draws the box
that was missing, and every rate in that unit's series corrects itself. A copied
number would keep the old denominator with nothing to announce that it had gone
stale.

Germination therefore reads as two counts under two models:

| Observation | Read for          | Tally | Role                     |
| ----------- | ----------------- | ----- | ------------------------ |
| Day 0       | Seed detector     | 20    | Denominator for the unit |
| Day 14      | Germination model | 15    | Numerator for the day    |

The rate is 15 over 20. Neither model declares a germination rate, and neither
model needs to recognize more than one class. The germination model may have
never been trained: day 14 is then counted by the reviewer, and those counts
are the dataset its first version comes from.

## Several classes in one reading

A reading counts every instance it found, whatever class each one carries. A
model that recognizes an individual and its response in one pass therefore
counts both together, and a day read that way divides by a population equal to
its own count. Germination is read instead as two counts under two models, as
above.

## What the grid shows

A column is the day, and names the model as well only when the days do not all
read for the same one. A cell shows the unit's count, and its rate beside it
where there is one. A treatment's row summarizes its replicates by their rates
when every replicate counted has one, and by their counts otherwise, in both
cases as the mean, the sample standard deviation, and the number of replicates
behind it.

## Culture events

A culture event decides whether a unit's reading enters an analysis, and the
rules are unchanged: contaminated, discarded, and missing exclude the unit from
the observation that records the event onwards; nonviable and harvested keep it
included. An excluded unit contributes to no treatment summary.
