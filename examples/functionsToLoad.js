

function prettyPrintJob(job) {
    console.log(JSON.stringify(job, null, '  '));
}

module.exports = function(context) {
    context.prettyPrintJob = prettyPrintJob;
};
