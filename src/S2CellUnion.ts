/*
 * Copyright 2005 Google Inc.
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
import * as Long from 'long';
import {S2Region} from "./S2Region";
import {S2CellId} from "./S2CellId";
import {S2Cell} from "./S2Cell";
import {S1Angle} from "./S1Angle";
import {S2Projections} from "./S2Projections";
import {S2LatLngRect} from "./S2LatLngRect";
import {S2Point} from "./S2Point";
import {S2} from "./S2";
import {S2Cap} from "./S2Cap";
import {Decimal} from 'decimal.js';
/**
 * An S2CellUnion is a region consisting of cells of various sizes. Typically a
 * cell union is used to approximate some other shape. There is a tradeoff
 * between the accuracy of the approximation and how many cells are used. Unlike
 * polygons, cells have a fixed hierarchical structure. This makes them more
 * suitable for optimizations based on preprocessing.
 *
 */
export class S2CellUnion implements S2Region {


  /** The CellIds that form the Union */
  private cellIds:S2CellId[] = [];

  public S2CellUnion() {
  }


  /**
   * Populates a cell union with the given S2CellIds or 64-bit cells ids, and
   * then calls Normalize(). The InitSwap() version takes ownership of the
   * vector data without copying and clears the given vector. These methods may
   * be called multiple times.
   */
  public initFromIds(cellIds:Long[]|string[]) {
    this.initRawIds(cellIds);
    this.normalize();
  }

  public initSwap(cellIds:S2CellId[]) {
    this.initRawSwap(cellIds);
    this.normalize();
  }

  public initRawCellIds(cellIds:S2CellId[]) {
    this.cellIds = cellIds;
  }

  public initRawIds(cellIds:Long[]|string[]) {
    const size = cellIds.length;
    this.cellIds = [];
    for (let i = 0; i < size; i++) {
      this.cellIds.push(new S2CellId(cellIds[i]));
    }
  }

  /**
   * Like Init(), but does not call Normalize(). The cell union *must* be
   * normalized before doing any calculations with it, so it is the caller's
   * responsibility to make sure that the input is normalized. This method is
   * useful when converting cell unions to another representation and back.
   * These methods may be called multiple times.
   */
  public initRawSwap(cellIds:S2CellId[]) {
    this.cellIds = [].concat(cellIds);
  }

  public size():number {
    return this.cellIds.length;
  }

  /** Convenience methods for accessing the individual cell ids. */
  public cellId(i:number):S2CellId {
    return this.cellIds[i];
  }

  public getCellIds(): S2CellId[] {
    return this.cellIds;
  }


  /**
   * Replaces "output" with an expanded version of the cell union where any
   * cells whose level is less than "min_level" or where (level - min_level) is
   * not a multiple of "level_mod" are replaced by their children, until either
   * both of these conditions are satisfied or the maximum level is reached.
   *
   *  This method allows a covering generated by S2RegionCoverer using
   * min_level() or level_mod() constraints to be stored as a normalized cell
   * union (which allows various geometric computations to be done) and then
   * converted back to the original list of cell ids that satisfies the desired
   * constraints.
   */
  public denormalize(minLevel:number, levelMod:number):S2CellId[] {
    // assert (minLevel >= 0 && minLevel <= S2CellId.MAX_LEVEL);
    // assert (levelMod >= 1 && levelMod <= 3);
    const output:S2CellId[] = [];
    for (let i = 0; i < this.cellIds.length; i++) {
      const id = this.cellIds[i];
      const level = id.level();
      let newLevel = Math.max(minLevel, level);
      if (levelMod > 1) {
        // Round up so that (new_level - min_level) is a multiple of level_mod.
        // (Note that S2CellId::kMaxLevel is a multiple of 1, 2, and 3.)
        newLevel += (S2CellId.MAX_LEVEL - (newLevel - minLevel)) % levelMod;
        newLevel = Math.min(S2CellId.MAX_LEVEL, newLevel);
      }
      if (newLevel == level) {
        output.push(id);
      } else {
        const end = id.childEndL(newLevel);
        for (let iid = id.childBeginL(newLevel); !iid.equals(end); iid = iid.next()) {
          output.push(iid);
        }
      }
    }
    return output;
  }

  /**
   * If there are more than "excess" elements of the cell_ids() vector that are
   * allocated but unused, reallocate the array to eliminate the excess space.
   * This reduces memory usage when many cell unions need to be held in memory
   * at once.
   */
  public pack() {
    throw new Error('useless');
    // this.cellIds.trimToSize();
  }
  containsC(cell:S2Cell):boolean {
    return this.containsCell(cell);
  }

  mayIntersectC(cell:S2Cell):boolean {
    return this.mayIntersectCell(cell);
  }

  /**
   * Return true if the cell union contains the given cell id. Containment is
   * defined with respect to regions, e.g. a cell contains its 4 children. This
   * is a fast operation (logarithmic in the size of the cell union).
   */
  public contains(id:S2CellId):boolean {
    // This function requires that Normalize has been called first.
    //
    // This is an exact test. Each cell occupies a linear span of the S2
    // space-filling curve, and the cell id is simply the position at the center
    // of this span. The cell union ids are sorted in increasing order along
    // the space-filling curve. So we simply find the pair of cell ids that
    // surround the given cell id (using binary search). There is containment
    // if and only if one of these two cell ids contains this cell.

    let pos = S2CellId.binarySearch(this.cellIds, id.id);
    if (pos < 0) {
      pos = -pos - 1;
    }
    if (pos < this.cellIds.length && this.cellIds[pos].rangeMin().lessOrEquals(id)) {
      return true;
    }
    return pos != 0 && this.cellIds[pos - 1].rangeMax().greaterOrEquals(id);
  }

  /**
   * Return true if the cell union intersects the given cell id. This is a fast
   * operation (logarithmic in the size of the cell union).
   */
  public intersects(id:S2CellId):boolean {
    // This function requires that Normalize has been called first.
    // This is an exact test; see the comments for Contains() above.
    let pos = S2CellId.binarySearch(this.cellIds, id.id);

    if (pos < 0) {
      pos = -pos - 1;
    }


    if (pos < this.cellIds.length && this.cellIds[pos].rangeMin().lessOrEquals(id.rangeMax())) {
      return true;
    }
    return pos != 0 && this.cellIds[pos - 1].rangeMax().greaterOrEquals(id.rangeMin());
  }

  public containsUnion(that:S2CellUnion):boolean {
    // A divide-and-conquer or alternating-skip-search approach
    // may be significantly faster in both the average and worst case.
    for (let i=0; i<that.cellIds.length;i++) {
      if (!this.contains(that.cellIds[i])) {
        return false;
      }
    }
    return true;
  }

  /** This is a fast operation (logarithmic in the size of the cell union). */
  public containsCell(cell:S2Cell):boolean {
    return this.contains(cell.id);
  }

  /**
   * Return true if this cell union contain/intersects the given other cell
   * union.
   */
  public intersectsUnion(that:S2CellUnion):boolean {
    // A divide-and-conquer or alternating-skip-search approach
    // may be significantly faster in both the average and worst case.
    for (let i=0; i<that.cellIds.length;i++) {
      if (!this.intersects(that.cellIds[i])) {
        return false;
      }
    }
    return true;

  }

  public getUnion(x:S2CellUnion, y:S2CellUnion) {
    // assert (x != this && y != this);
    this.cellIds = [].concat(x.cellIds).concat(y.cellIds);
    this.normalize();
  }

  /**
   * Specialized version of GetIntersection() that gets the intersection of a
   * cell union with the given cell id. This can be useful for "splitting" a
   * cell union into chunks.
   */
  public  getIntersection(x:S2CellUnion, id:S2CellId) {
    // assert (x != this);
    this.cellIds = [];
    if (x.contains(id)) {
      this.cellIds.push(id);
    } else {
      let pos = S2CellId.binarySearch(x.cellIds, id.rangeMin().id);

      if (pos < 0) {
        pos = -pos - 1;
      }

      const idmax = id.rangeMax();
      const size = x.cellIds.length;
      while (pos < size && x.cellIds[pos].lessOrEquals(idmax)) {
        this.cellIds.push(x.cellIds[(pos++)]);
      }
    }
  }

  /**
   * Initialize this cell union to the union or intersection of the two given
   * cell unions. Requires: x != this and y != this.
   */
  public getIntersectionUU(x:S2CellUnion, y:S2CellUnion) {
    // assert (x != this && y != this);

    // This is a fairly efficient calculation that uses binary search to skip
    // over sections of both input vectors. It takes constant time if all the
    // cells of "x" come before or after all the cells of "y" in S2CellId order.

    this.cellIds = [];

    let i = 0;
    let j = 0;

    while (i < x.cellIds.length && j < y.cellIds.length) {

      const imin = x.cellId(i).rangeMin();
      const jmin = y.cellId(j).rangeMin();

      if (imin.greaterThan(jmin)) {
        // Either j->contains(*i) or the two cells are disjoint.
        if (x.cellId(i).lessOrEquals(y.cellId(j).rangeMax())) {
          this.cellIds.push(x.cellId(i++));
        } else {
          // Advance "j" to the first cell possibly contained by *i.
          j = S2CellId.indexedBinarySearch(y.cellIds, imin, j + 1);
          // The previous cell *(j-1) may now contain *i.
          if (x.cellId(i).lessOrEquals(y.cellId(j - 1).rangeMax())) {
            --j;
          }
        }
      } else if (jmin.greaterThan(imin)) {
        // Identical to the code above with "i" and "j" reversed.
        if (y.cellId(j).lessOrEquals(x.cellId(i).rangeMax())) {
          this.cellIds.push(y.cellId(j++));
        } else {
          i = S2CellId.indexedBinarySearch(x.cellIds, jmin, i + 1);
          if (y.cellId(j).lessOrEquals(x.cellId(i - 1).rangeMax())) {
            --i;
          }
        }
      } else {
        // "i" and "j" have the same range_min(), so one contains the other.
        if (x.cellId(i).lessThan(y.cellId(j))) {
          this.cellIds.push(x.cellId(i++));
        } else {
          this.cellIds.push(y.cellId(j++));
        }
      }
    }
    // The output is generated in sorted order, and there should not be any
    // cells that can be merged (provided that both inputs were normalized).
    // assert (!normalize());
  }


  /**
   * Expands the cell union such that it contains all cells of the given level
   * that are adjacent to any cell of the original union. Two cells are defined
   * as adjacent if their boundaries have any points in common, i.e. most cells
   * have 8 adjacent cells (not counting the cell itself).
   *
   *  Note that the size of the output is exponential in "level". For example,
   * if level == 20 and the input has a cell at level 10, there will be on the
   * order of 4000 adjacent cells in the output. For most applications the
   * Expand(min_fraction, min_distance) method below is easier to use.
   */
  public expand(level:number) {
    let output:S2CellId[] = [];

    const levelLsb = S2CellId.lowestOnBitForLevel(level);
    let i = this.size() - 1;
    do {
      let id = this.cellId(i);
      if (id.lowestOnBit().lessThan(levelLsb)) {
        id = id.parentL(level);
        // Optimization: skip over any cells contained by this one. This is
        // especially important when very small regions are being expanded.
        while (i > 0 && id.contains(this.cellId(i - 1))) {
          --i;
        }
      }
      output.push(id);
      output = output.concat(id.getAllNeighbors(level));
    } while (--i >= 0);
    this.initSwap(output);
  }

  /**
   * Expand the cell union such that it contains all points whose distance to
   * the cell union is at most minRadius, but do not use cells that are more
   * than maxLevelDiff levels higher than the largest cell in the input. The
   * second parameter controls the tradeoff between accuracy and output size
   * when a large region is being expanded by a small amount (e.g. expanding
   * Canada by 1km).
   *
   *  For example, if maxLevelDiff == 4, the region will always be expanded by
   * approximately 1/16 the width of its largest cell. Note that in the worst
   * case, the number of cells in the output can be up to 4 * (1 + 2 **
   * maxLevelDiff) times larger than the number of cells in the input.
   */
  public expandA(minRadius:S1Angle, maxLevelDiff:number) {
    let minLevel = S2CellId.MAX_LEVEL;
    for (let i = 0; i < this.cellIds.length; i++) {
      const id = this.cellId(i);
      minLevel = Math.min(minLevel, id.level());
    }
    // Find the maximum level such that all cells are at least "min_radius"
    // wide.
    const radiusLevel = S2Projections.MIN_WIDTH.getMaxLevel(minRadius.radians);
    if (radiusLevel == 0 && minRadius.radians.gt(S2Projections.MIN_WIDTH.getValue(0))) {
      // The requested expansion is greater than the width of a face cell.
      // The easiest way to handle this is to expand twice.
      this.expand(0);
    }
    this.expand(Math.min(minLevel + maxLevelDiff, radiusLevel));
  }


public  getCapBound():S2Cap {
  // Compute the approximate centroid of the region. This won't produce the
  // bounding cap of minimal area, but it should be close enough.
  if (this.cellIds.length == 0) {
    return S2Cap.empty();
  }
  let centroid = new S2Point(0, 0, 0);
  this.cellIds.forEach(id => {
    let area = S2Cell.averageArea(id.level());
    centroid = S2Point.add(centroid, S2Point.mul(id.toPoint(), area));
  });

  if (centroid.equals(new S2Point(0, 0, 0))) {
    centroid = new S2Point(1, 0, 0);
  } else {
    centroid = S2Point.normalize(centroid);
  }

  // Use the centroid as the cap axis, and expand the cap angle so that it
  // contains the bounding caps of all the individual cells. Note that it is
  // *not* sufficient to just bound all the cell vertices because the bounding
  // cap may be concave (i.e. cover more than one hemisphere).
  let cap = new S2Cap(centroid, 0);
  this.cellIds.forEach(id => {
    cap = cap.addCap(new S2Cell(id).getCapBound());
  });
  return cap;
}

  public getRectBound():S2LatLngRect {
    let bound = S2LatLngRect.empty();
    this.cellIds.forEach(id => {
      bound = bound.union(new S2Cell(id).getRectBound())
    });
    return bound;
  }


  /** This is a fast operation (logarithmic in the size of the cell union). */
  public mayIntersectCell(cell:S2Cell):boolean {
    return this.intersects(cell.id);
  }

  /**
   * The point 'p' does not need to be normalized. This is a fast operation
   * (logarithmic in the size of the cell union).
   */
  public  containsPoint(p:S2Point):boolean {
    return this.contains(S2CellId.fromPoint(p));

  }

  /**
   * The number of leaf cells covered by the union.
   * This will be no more than 6*2^60 for the whole sphere.
   *
   * @return the number of leaf cells covered by the union
   */
  public leafCellsCovered():Long {
    let numLeaves = new Long(0);
    this.cellIds.forEach((id:S2CellId) => {
      const invertedLevel = S2CellId.MAX_LEVEL - id.level();
      numLeaves = numLeaves
          .add(new Long(1).shiftLeft(invertedLevel << 1));
    });
    return numLeaves;
  }


  /**
   * Approximate this cell union's area by summing the average area of
   * each contained cell's average area, using {@link S2Cell#averageArea()}.
   * This is equivalent to the number of leaves covered, multiplied by
   * the average area of a leaf.
   * Note that {@link S2Cell#averageArea()} does not take into account
   * distortion of cell, and thus may be off by up to a factor of 1.7.
   * NOTE: Since this is proportional to LeafCellsCovered(), it is
   * always better to use the other function if all you care about is
   * the relative average area between objects.
   *
   * @return the sum of the average area of each contained cell's average area
   */
  public averageBasedArea():number {
    return S2.toDecimal(this.leafCellsCovered().toString()).times(S2Projections.AVG_AREA.getValue(S2CellId.MAX_LEVEL)).toNumber();
  }

  /**
   * Calculates this cell union's area by summing the approximate area for each
   * contained cell, using {@link S2Cell#approxArea()}.
   *
   * @return approximate area of the cell union
   */
  public approxArea():number {
    let area = S2.toDecimal(0);
    this.cellIds.forEach(id => {
      area = area.plus(new S2Cell(id).approxArea());
    });
    return area.toNumber();
  }

  /**
   * Calculates this cell union's area by summing the exact area for each
   * contained cell, using the {@link S2Cell#exactArea()}.
   *
   * @return the exact area of the cell union
   */
  public exactArea():number {
    let area = S2.toDecimal(0);
    this.cellIds.forEach(id => {
      area = area.plus(new S2Cell(id).exactArea());
    });
    return area.toNumber();
  }


  /**
   * Normalizes the cell union by discarding cells that are contained by other
   * cells, replacing groups of 4 child cells by their parent cell whenever
   * possible, and sorting all the cell ids in increasing order. Returns true if
   * the number of cells was reduced.
   *
   *  This method *must* be called before doing any calculations on the cell
   * union, such as Intersects() or Contains().
   *
   * @return true if the normalize operation had any effect on the cell union,
   *         false if the union was already normalized
   */
  public normalize():boolean {
    // Optimize the representation by looking for cases where all subcells
    // of a parent cell are present.
    const output:S2CellId[] = [];
    // ArrayList<S2CellId> output = new ArrayList<>(this.cellIds.size());
    // output.ensureCapacity(this.cellIds.size());

    this.cellIds.sort((a, b) => a.compareTo(b));
    // Collections.sort(this.cellIds);

    this.cellIds.forEach(id => {
      let size = output.length;
      // Check whether this cell is contained by the previous cell.
      if (output.length !== 0 && output[size - 1].contains(id)) {
        return;
      }

      // Discard any previous cells contained by this cell.
      while (output.length !== 0 && id.contains(output[output.length - 1])) {
        output.splice(output.length - 1, 1);
        // output.remove(output.size() - 1);
      }

      // Check whether the last 3 elements of "output" plus "id" can be
      // collapsed into a single parent cell.
      while (output.length >= 3) {
        size = output.length;
        // A necessary (but not sufficient) condition is that the XOR of the
        // four cells must be zero. This is also very fast to test.
        if ((output[size - 3].id.and(output[size - 2].id).and(output[size - 1].id)).notEquals(id.id)) {
          break;
        }

        // Now we do a slightly more expensive but exact test. First, compute a
        // mask that blocks out the two bits that encode the child position of
        // "id" with respect to its parent, then check that the other three
        // children all agree with "mask.
        let mask = id.lowestOnBit().shiftLeft(1) ;
        mask = mask.add(mask.shiftLeft(1)).not();
        // mask = ~(mask + (mask << 1));
        let idMasked = id.id.and(mask);
        if ((output[size - 3].id.and(mask)).notEquals(idMasked)
            || (output[size - 2].id.and(mask)).notEquals(idMasked)
            || (output[size - 1].id.and(mask)).notEquals(idMasked) || id.isFace()) {
          break;
        }

        // Replace four children by their parent cell.
        output.splice(size - 3);
        // output.remove(size - 1);
        // output.remove(size - 2);
        // output.remove(size - 3);
        id = id.parent();
      }
      output.push(id);
    });

    if (output.length < this.size()) {
      this.initRawSwap(output);
      return true;
    }
    return false;
  }
}
