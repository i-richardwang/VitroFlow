# vitroflow

Prepare culture-dish photographs for a [VitroFlow](https://github.com/i-richardwang/VitroFlow) workbench.

A dish is often photographed several times in a row. `vitroflow photos select` sorts a folder of photographs into dishes and chooses, for each dish, the photograph whose seeds are sharpest. The chosen photographs are the ones to upload, for example through the workbench's experiments MCP server.

```bash
uvx vitroflow photos select ~/plates
```

The command reads the folder's JPEG, PNG and TIFF files, prints JSON, and leaves every file where it is:

```json
{
  "dishes": [
    {
      "chosen": "/home/lab/plates/plate-02.jpg",
      "alternatives": ["/home/lab/plates/plate-01.jpg"],
      "photos": [
        { "path": "/home/lab/plates/plate-02.jpg", "sharpness": 0.0 },
        { "path": "/home/lab/plates/plate-01.jpg", "sharpness": -0.05 },
        { "path": "/home/lab/plates/plate-03.jpg", "sharpness": -0.4 }
      ]
    }
  ],
  "skipped": [
    { "path": "/home/lab/plates/notes.png", "reason": "no dish found" }
  ]
}
```

Each entry of `dishes` is one dish. `photos` lists its photographs sharpest first; `sharpness` is the natural log of how sharply a photograph renders the seeds relative to the chosen one, so `-0.4` is about a third less fine detail. A dish photographed once has a `sharpness` of `null`. `alternatives` are photographs within 0.1 of the chosen one, which serve as well. `skipped` lists files that could not be read or that show no dish.

## How photographs are matched

Photographs show the same dish when one movement of the camera carries the layout of the whole dish, seeds, substrate outline and lid labels alike, from one photograph onto the other. Agreement in one small region, such as a date label that every dish of a batch carries, is not enough. The decision depends on the share of features that agree and the area they cover, not on how many seeds a dish holds, and the handwriting on labels is never read.

## How focus is judged

Two photographs of one dish are compared at the same physical points within the central 60% of the dish's radius, where the seeds lie and the lid labels do not reach. At each point the finest detail is weighed against the seed's outline, which cancels exposure, so a photograph focused on the labels rather than the seeds ranks low.

## Whether a photograph can be counted

`vitroflow photos check` looks at each photograph on its own and says whether its seeds can be counted. Run it on the photographs you intend to keep, for example the ones `select` chose.

```bash
uvx vitroflow photos check ~/plates/chosen
```

The command prints JSON and leaves every file where it is:

```json
{
  "photos": [
    { "path": "/home/lab/plates/chosen/plate-02.jpg", "suitable": true, "reason": null },
    {
      "path": "/home/lab/plates/chosen/plate-18.jpg",
      "suitable": false,
      "reason": "seeds are out of focus"
    }
  ],
  "skipped": [
    { "path": "/home/lab/plates/chosen/notes.png", "reason": "no dish found" }
  ]
}
```

The seeds lie on the filter paper, inside the rim, where the lid labels do not reach. They can be counted when their own mark is crisp against the paper. `suitable` is false when that mark has gone soft (`seeds are out of focus`), or when tiny gray droplets are spread across the paper and the seeds themselves are not a crisp colored mark (`paper covered by droplets`). `reason` is `null` when the seeds can be told apart. A small seed that is still a separate mark stays, including a germinated seed.
