/**
  * Executes an array of async task functions with a concurrency ceiling.
  * 
  * @param {Array<() => Promise<any>>} tasks Array of task functions returning Promises
  * @param {number} concurrencyLimit Maximum number of concurrent tasks (default: 50)
  * @returns {Promise<Array<any>>} Array of task results
  */
 async function runWithConcurrencyLimit(tasks, concurrencyLimit = 50) {
   if (!Array.isArray(tasks) || tasks.length === 0) return [];

   const results = new Array(tasks.length);
   let currentIndex = 0;

   async function worker() {
     while (currentIndex < tasks.length) {
       const index = currentIndex++;
       try {
         results[index] = await tasks[index]();
       } catch (err) {
         results[index] = { error: err.message };
       }
     }
   }

   const poolSize = Math.min(concurrencyLimit, tasks.length);
   const workers = [];
   for (let i = 0; i < poolSize; i++) {
     workers.push(worker());
   }

   await Promise.all(workers);
   return results;
 }

 module.exports = {
   runWithConcurrencyLimit
 };
