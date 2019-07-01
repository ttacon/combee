combee
=====

## Installation

```sh
npm i -g combee
```

## Usage

```sh
combee --redis=redis://localhost:6379 --queues=foo,bar
combee::> combee.listQueues()
[ { name: 'foo' }, { name: 'bar' } ]

combee::> combee.foo.stats()
undefined
combee::> { waiting: 1,
  active: 0,
  succeeded: 0,
  failed: 0,
  delayed: 0,
  newestJob: 6 }

combee::> combee.foo.list()
undefined
combee::> []

combee::> combee.foo.list('waiting')
undefined
combee::> [ { id: '6',
    data: { yolo: 'solo' },
    options: { timestamp: 1561948255429, stacktraces: [] },
    status: 'created' } ]

combee::> combee.foo.createJob({yolo:'yolo'})
undefined
combee::> { id: '7',
  data: { yolo: 'yolo' },
  options: { timestamp: 1561948417944, stacktraces: [] },
  status: 'created' }

combee::> combee.foo.list('waiting')
undefined
combee::> [ { id: '7',
    data: { yolo: 'yolo' },
    options: { timestamp: 1561948417944, stacktraces: [] },
    status: 'created' },
  { id: '6',
    data: { yolo: 'solo' },
    options: { timestamp: 1561948255429, stacktraces: [] },
    status: 'created' } ]

combee::> combee.foo.removeJobs('waiting', { 'data.yolo': 'solo' })
undefined
combee::> removed 1 jobs

combee::> combee.foo.list('waiting')
undefined
combee::> [ { id: '7',
    data: { yolo: 'yolo' },
    options: { timestamp: 1561948417944, stacktraces: [] },
    status: 'created' } ]

combee::> 
```