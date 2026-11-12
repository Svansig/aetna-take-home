# Movie API Code Test

## Pre-requisites

* An IDE or text editor of your choice
* [Sqlite3](http://www.sqlitetutorial.net/)


## Task
Your task is to create an API on top of a couple different databases.  It should conform to the user stories provided below.  You are free to use whatever language you prefer, however our tech stack features NodeJS, Java and Ruby. If you're comfortable with any of these, try to favor them.  Google and the interwebs are at your disposal.

**The Databases**
The databases are provided as a SQLite3 database in `db/`.  It does not require any credentials to login.  You can run SQL queries directly against the database using:

```
sqlite <path to db file>
```

`.tables` will return a list of available tables and `.schema <table>` will provide the schema.

## Considerations
When developing your solution, please consider the following:

* Structure of your endpoints - Can you easily extend the API to support new endpoints as feature requests come in?
* Quality of your code - Does your code demonstrate the use of design patterns?
* Testability - Is your code testable?
* Can your solution be easily configured and deployed?  Consider guidelines from [12 Factor App](http://12factor.net/)


## User Stories

#### List All Movies
AC:

* An endpoint exists that lists all movies
* List is paginated: 50 movies per page, the page can be altered with the `page` query params
* Columns should include: imdb id, title, genres, release date, budget
* Budget is displayed in dollars

#### Movie Details
AC:

* An endpoint exists that lists the movie details for a particular movie
* Details should include: imdb id, title, description, release date, budget, runtime, average rating, genres, original language, production companies
* Budget should be displayed in dollars
* Ratings are pulled from the rating database

#### Movies By Year
AC:

* An endpoint exists that will list all movies from a particular year 
* List is paginated: 50 movies per page, the page can be altered with the `page` query params
* List is sorted by date in chronological order
* Sort order can be descending
* Columns include: imdb id, title, genres, release date, budget

#### Movies By Genre
AC:

* An endpoint exists that will list all movies by a genre
* List is paginated: 50 movies per page, the page can be altered with the `page` query params
* Columns include: imdb id, title, genres, release date, budget

## Tips

* This is a test of your abilities and not how fast you can crank through random stories.  As such, it is more important to produce well structured code that meets the criteria in the user stories rather than getting all stories done.
* If you get stuck, please ask someone.  We want to know how you work both as an individual and as part of a team.  You will not lose points for asking for help on something that is unclear or where you are stuck.
