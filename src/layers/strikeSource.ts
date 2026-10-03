import VectorSource from "ol/source/Vector";

/**
 * A vector source that can take many strikes for one change.
 *
 * The flat map draws its strikes through a Cluster, and a cluster source
 * reclusters every feature on each change of the source under it. Added one
 * at a time, the thousand strikes /lightning_cache answers with were a
 * thousand reclusterings of a growing set: a third of a second of main thread
 * on every page load, and every wake.
 *
 * Not `addFeatures`: that bulk-loads the spatial index, which then hands the
 * features to the Cluster in another order, and greedy clustering groups by
 * order -- the same strikes came out as different clusters. Inside `batch`
 * every add and remove happens one by one exactly as before; only the change
 * events are held back, and sent as one at the end.
 */
export default class StrikeSource extends VectorSource {
  private batching = false;

  private changedInBatch = false;

  /** Run `edit`, with whatever change it makes announced once, when it is done. */
  batch(edit: () => void) {
    if (this.batching) {
      edit();
      return;
    }
    this.batching = true;
    try {
      edit();
    } finally {
      this.batching = false;
      if (this.changedInBatch) {
        this.changedInBatch = false;
        this.changed();
      }
    }
  }

  changed() {
    if (this.batching) {
      this.changedInBatch = true;
      return;
    }
    super.changed();
  }
}
