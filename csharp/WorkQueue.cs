using System;
using System.Threading;
using System.Collections.Generic;

namespace SCAMPUtil
{
	/// <summary>
	/// Manages a list of actions to perform on the system thread pool with bounded concurrency.
	/// </summary>
	public class WorkQueue
	{
		Queue<Action> q = new Queue<Action> ();
		object lk = new object ();
		int concurrency;
		int nrunning;
		int maxlength;

		/// <summary>
		/// Creates a new work queue.
		/// </summary>
		/// <param name="concurrency">Maximum number of jobs to run at once.</param>
		/// <param name="maxlength">Maximum number of queued jobs.</param>
		public WorkQueue (int concurrency = 1, int maxlength = int.MaxValue)
		{
			this.concurrency = concurrency;
			this.maxlength = maxlength;
		}

		void RunWorkItem (Action item)
		{
			nrunning++;
			ThreadPool.UnsafeQueueUserWorkItem (state => {
				try {
					item ();
				} finally {
					lock (lk) {
						nrunning--;
						if (q.Count > 0)
							RunWorkItem (q.Dequeue ());
					}
				}
			}, null);
		}

		/// <summary>
		/// Adds a new item to the work queue.
		/// </summary>
		/// <param name="item">The function to call.</param>
		/// <returns>True if the item will be called, false if it fell off due to a length limit.</returns>
		public bool Enqueue (Action item)
		{
			lock (lk) {
				if (q.Count >= maxlength)
					return false;
				if (nrunning < concurrency) {
					RunWorkItem (item);
				} else {
					q.Enqueue (item);
				}
			}
			return true;
		}
	}
}

