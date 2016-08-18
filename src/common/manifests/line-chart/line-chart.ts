/*
 * Copyright 2015-2016 Imply Data, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { List } from 'immutable';
import { $, SortAction } from 'plywood';
import { Splits, DataCube, SplitCombine, Colors, Dimension } from '../../models/index';
import {
  CircumstancesHandler
} from '../../utils/circumstances-handler/circumstances-handler';
import { Manifest, Resolve } from '../../models/manifest/manifest';

var handler = CircumstancesHandler.EMPTY()

  .when((splits: Splits, dataCube: DataCube) => !(dataCube.dimensions.some((d) => d.canBucketByDefault())))
  .then(() => Resolve.NEVER)

  .when(CircumstancesHandler.noSplits())
  .then((splits: Splits, dataCube: DataCube) => {
    let bucketedDimensions = dataCube.dimensions.filter((d) => d.canBucketByDefault());
    return Resolve.manual(3, 'This visualization requires a continuous dimension split',
      bucketedDimensions.toArray().map((dimension) => {
        return {
          description: `Add a split on ${dimension.title}`,
          adjustment: {
            splits: Splits.fromSplitCombine(SplitCombine.fromExpression(dimension.expression))
          }
        };
      })
    );
  })
  .when((splits: Splits, dataCube: DataCube) => {
    return splits.toArray().length === 1 && splits.first().isBucketable(dataCube.dimensions);
  })
  .then((splits: Splits, dataCube: DataCube, colors: Colors, current: boolean) => {
    var score = 4;

    var continuousSplit = splits.get(0);
    var continuousDimension = dataCube.getDimensionByExpression(continuousSplit.expression);
    var sortStrategy = continuousDimension.sortStrategy;

    var sortAction: SortAction = null;
    if (sortStrategy && sortStrategy !== 'self') {
      sortAction = new SortAction({
        expression: $(sortStrategy),
        direction: SortAction.ASCENDING
      });
    } else {
      sortAction = new SortAction({
        expression: $(continuousDimension.name),
        direction: SortAction.ASCENDING
      });
    }

    let autoChanged = false;

    // Fix time sort
    if (!sortAction.equals(continuousSplit.sortAction)) {
      continuousSplit = continuousSplit.changeSortAction(sortAction);
      autoChanged = true;
    }

    // Fix time limit
    if (continuousSplit.limitAction && continuousDimension.kind === 'time') {
      continuousSplit = continuousSplit.changeLimitAction(null);
      autoChanged = true;
    }

    if (colors) {
      autoChanged = true;
    }

    if (continuousDimension.kind === 'time') score += 3;

    if (!autoChanged) return Resolve.ready(current ? 10 : score);
    return Resolve.automatic(score, {splits: new Splits(List([continuousSplit]))});
  })

  .when((splits: Splits, dataCube: DataCube) => {
      let splitsArray = splits.toArray();
      if (splitsArray.length !== 2) return false;
      let firstSplit = splitsArray[0];
      return firstSplit.getDimension(dataCube.dimensions).kind === 'time' && firstSplit.isBucketable(dataCube.dimensions);
  })
  .then((splits: Splits, dataCube: DataCube, colors: Colors) => {
    var timeSplit = splits.get(0);
    var timeDimension = timeSplit.getDimension(dataCube.dimensions);

    var sortAction: SortAction = new SortAction({
      expression: $(timeDimension.name),
      direction: SortAction.ASCENDING
    });

    // Fix time sort
    if (!sortAction.equals(timeSplit.sortAction)) {
      timeSplit = timeSplit.changeSortAction(sortAction);
    }

    // Fix time limit
    if (timeSplit.limitAction) {
      timeSplit = timeSplit.changeLimitAction(null);
    }

    let colorSplit = splits.get(1);

    if (!colorSplit.sortAction) {
      colorSplit = colorSplit.changeSortAction(dataCube.getDefaultSortAction());
    }

    var colorSplitDimension = dataCube.getDimensionByExpression(colorSplit.expression);
    if (!colors || colors.dimension !== colorSplitDimension.name) {
      colors = Colors.fromLimit(colorSplitDimension.name, 5);
    }

    return Resolve.automatic(8, {
      splits: new Splits(List([colorSplit, timeSplit])),
      colors
    });
  })

  .when((splits: Splits, dataCube: DataCube) => {
    var splitsArray = splits.toArray();
    if (splitsArray.length !== 2) return false;
    let secondSplit = splitsArray[1];
    return secondSplit.isBucketable(dataCube.dimensions);
  })
  .then((splits: Splits, dataCube: DataCube, colors: Colors) => {
    var secondSplit = splits.get(1);
    var timeDimension = secondSplit.getDimension(dataCube.dimensions);
    let autoChanged = false;

    var sortAction: SortAction = new SortAction({
      expression: $(timeDimension.name),
      direction: SortAction.ASCENDING
    });

    // Fix time sort
    if (!sortAction.equals(secondSplit.sortAction)) {
      secondSplit = secondSplit.changeSortAction(sortAction);
      autoChanged = true;
    }

    // Fix time limit
    if (secondSplit.limitAction) {
      secondSplit = secondSplit.changeLimitAction(null);
      autoChanged = true;
    }

    let colorSplit = splits.get(0);

    if (!colorSplit.sortAction) {
      colorSplit = colorSplit.changeSortAction(dataCube.getDefaultSortAction());
      autoChanged = true;
    }

    var colorSplitDimension = dataCube.getDimensionByExpression(colorSplit.expression);
    if (!colors || colors.dimension !== colorSplitDimension.name) {
      colors = Colors.fromLimit(colorSplitDimension.name, 5);
      autoChanged = true;
    }

    if (!autoChanged) return Resolve.ready(10);
    return Resolve.automatic(8, {
      splits: new Splits(List([colorSplit, secondSplit])),
      colors
    });
  })

  .when((splits: Splits, dataCube: DataCube) => {
    return splits.toArray().some((s) => s.isBucketable(dataCube.dimensions));
  })
  .then((splits: Splits, dataCube: DataCube) => {
    let timeSplit = splits.toArray().filter((split) => split.bucketAction !== null)[0];
    return Resolve.manual(3, 'Too many splits on the line chart', [
      {
        description: `Remove all but the first split`,
        adjustment: {
          splits: Splits.fromSplitCombine(timeSplit)
        }
      }
    ]);
  })

  .otherwise(
    (splits: Splits, dataCube: DataCube) => {
      let bucketableDimensions = dataCube.dimensions.filter(d => d.canBucketByDefault());
      return Resolve.manual(3, 'The Line Chart needs one bucketed split',
        bucketableDimensions.toArray().map((continuousDimension) => {
          return {
            description: `Split on ${continuousDimension.title} instead`,
            adjustment: {
              splits: Splits.fromSplitCombine(SplitCombine.fromExpression(continuousDimension.expression))
            }
          };
        })
      );
    }
  );


export const LINE_CHART_MANIFEST = new Manifest(
  'line-chart',
  'Line Chart',
  handler.evaluate.bind(handler)
);
