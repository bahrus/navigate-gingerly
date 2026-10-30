# navigate-gingerly

## Initial Goals, subject to change as it is implemented.

With the advent of new api's designed to stream HTML into a web page via partial updates, this suggests looking at ways we can architect applications to make use of these new techniques.

The biggest roadblock is that in today's environment, backend API's that provide HTML output is quite rare.  JSON response is now the norm.  Rewriting or enhancing these API's to provide HTML could be costly if each such write is done "manually".

So o2h-edge is a solution to this problem -- it tries to reduce the cost by providing a predictable, easy, reusable, declarative pattern for converting JSON API's into HTML API's with as much flexibility as possible, while adhering to data-driven configuration.  It includes a strategy for hydrating back into objects in the web browser, that benefits from adopting a common declarative approach uniformly to all APIs.

Suppose the JSON API, at it's core, follows a RESTful paradigm.  Using o2h-edge essentially ensures that the same RESTful routing will flow through, as it is just a pass-through combined with a significant data format transformation.

The final piece to the routing puzzle is how the backend api routing relates to front end routing.

Most applications (I'm guessing) don't make much of an effort, if any, to try to align the end user routing browser url paths to the the back end api's.  But with the API's providing HTML output instead of JSON, I think the benefits of at least trying when possible to get this alignment would tend to make more sense.

Undoubtedly, following such an approach could result in a rapid prototype of an application, where it is viewed as basically a wrapper around (a subset of the) backend-api's.

This package provides some utilities to help maintain this alignment.